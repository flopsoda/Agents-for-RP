#!/usr/bin/env python3
"""Test Run Inspector prompt dumps against Ollama Cloud chat completions.

The input file should use the Run Inspector prompt format:

    [0] system
    ...
    [1] user
    ...

Examples:

    python3 scripts/test_ollama_prompt.py pasted-text.txt --mode no-context-guards
    python3 scripts/test_ollama_prompt.py pasted-text.txt --mode single-system --model deepseek-v4-pro:cloud
    python3 scripts/test_ollama_prompt.py pasted-text.txt --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_BASE_URL = "https://ollama.com/v1"
DEFAULT_MODEL = "gemini-3-flash-preview:cloud"
DEFAULT_ENV_FILE = ".env"
DEFAULT_API_KEY_ENV = "OLLAMA_API_KEY"
MESSAGE_HEADER_RE = re.compile(r"^\[(\d+)\]\s+(system|user|assistant)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class Message:
    index: int
    role: str
    content: str


@dataclass(frozen=True)
class TransformResult:
    messages: list[Message]
    notes: list[str]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in os.environ:
            continue
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        os.environ[key] = value


def parse_prompt_dump(path: Path) -> list[Message]:
    text = path.read_text(encoding="utf-8")
    matches = list(MESSAGE_HEADER_RE.finditer(text))
    if not matches:
        raise ValueError(f"No Run Inspector message headers found in {path}")

    messages: list[Message] = []
    for idx, match in enumerate(matches):
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        content = text[start:end]
        if content.startswith("\n"):
            content = content[1:]
        content = content.removesuffix("\n")
        messages.append(Message(index=int(match.group(1)), role=match.group(2), content=content))
    return messages


def is_reference_context_guard(message: Message) -> bool:
    return (
        message.role == "system"
        and "The next user message contains reference context only." in message.content
    )


def is_immediate_turn_context_guard(message: Message) -> bool:
    return (
        message.role == "system"
        and "The next user message contains immediate turn context for the current post-processing task."
        in message.content
    )


def is_generated_guard(message: Message) -> bool:
    return (
        is_reference_context_guard(message)
        or is_immediate_turn_context_guard(message)
        or (
            message.role == "system"
            and (
                "The next user message contains the actual post-processing task." in message.content
                or "The next user message contains the actual pre-processing task for auxiliary analysis."
                in message.content
            )
        )
    )


def transform_messages(messages: list[Message], mode: str) -> TransformResult:
    if mode == "original":
        return TransformResult(messages=list(messages), notes=["kept original message order"])

    if mode == "no-context-guards":
        kept: list[Message] = []
        removed: list[Message] = []
        for message in messages:
            if is_reference_context_guard(message) or is_immediate_turn_context_guard(message):
                removed.append(message)
            else:
                kept.append(message)
        return TransformResult(
            messages=kept,
            notes=[
                "removed reference/immediate context guard system messages only",
                f"removed indexes: {format_indexes(removed)}",
            ],
        )

    if mode == "single-system":
        system_parts = [message.content for message in messages if message.role == "system"]
        non_system = [message for message in messages if message.role != "system"]
        if not system_parts:
            return TransformResult(messages=list(messages), notes=["no system messages to merge"])
        merged_system = Message(
            index=0,
            role="system",
            content="\n\n---\n\n".join(part for part in system_parts if part.strip()),
        )
        return TransformResult(
            messages=[merged_system, *non_system],
            notes=[
                "merged all system messages into one leading system message",
                f"merged system indexes: {format_indexes([m for m in messages if m.role == 'system'])}",
            ],
        )

    if mode == "first-system-only":
        kept = []
        removed = []
        first_system_seen = False
        for message in messages:
            if message.role != "system":
                kept.append(message)
                continue
            if not first_system_seen:
                first_system_seen = True
                kept.append(message)
            else:
                removed.append(message)
        return TransformResult(
            messages=kept,
            notes=[
                "kept first system message and removed later system messages",
                f"removed indexes: {format_indexes(removed)}",
            ],
        )

    if mode == "no-generated-guards":
        kept = []
        removed = []
        for message in messages:
            if is_generated_guard(message):
                removed.append(message)
            else:
                kept.append(message)
        return TransformResult(
            messages=kept,
            notes=[
                "removed generated Agents! guard system messages",
                f"removed indexes: {format_indexes(removed)}",
            ],
        )

    raise ValueError(f"Unknown mode: {mode}")


def format_indexes(messages: Iterable[Message]) -> str:
    values = [f"[{message.index}] {message.role}" for message in messages]
    return ", ".join(values) if values else "(none)"


def as_api_messages(messages: list[Message]) -> list[dict[str, str]]:
    return [{"role": message.role, "content": message.content} for message in messages]


def build_payload(args: argparse.Namespace, messages: list[Message]) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": args.model,
        "messages": as_api_messages(messages),
        "temperature": args.temperature,
    }
    if args.max_tokens is not None:
        payload["max_tokens"] = args.max_tokens
    return payload


def post_chat_completion(base_url: str, api_key: str, payload: dict[str, object], timeout: int) -> dict[str, object]:
    url = f"{base_url.rstrip('/')}/chat/completions"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {error_body}") from exc


def extract_content(response: dict[str, object]) -> str:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        return content if isinstance(content, str) else ""
    text = first.get("text")
    return text if isinstance(text, str) else ""


def extract_block(text: str, block_name: str) -> str:
    pattern = re.compile(
        rf"<{re.escape(block_name)}>\n?(.*?)\n?</{re.escape(block_name)}>",
        re.DOTALL,
    )
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


def normalized_paragraphs(text: str, min_len: int = 80) -> list[str]:
    paragraphs = []
    for raw in re.split(r"\n\s*\n", text):
        value = re.sub(r"\s+", " ", raw).strip()
        if len(value) >= min_len:
            paragraphs.append(value)
    return paragraphs


def analyze_output(prompt_messages: list[Message], content: str) -> dict[str, object]:
    full_prompt = "\n\n".join(message.content for message in prompt_messages)
    previous_response = extract_block(full_prompt, "Latest Previous Assistant Response")
    current_response = extract_block(full_prompt, "Current Response")

    markdown_status = []
    date_status = []
    follower_status = []
    narrator_lines = []
    for line_no, line in enumerate(content.splitlines(), start=1):
        if re.search(r"^\s*#{2,6}.*\b(Character Sheet|Journal|Follower Status)\b", line, re.IGNORECASE):
            markdown_status.append({"line": line_no, "text": line})
        if line.startswith("[Date:"):
            date_status.append({"line": line_no, "text": line})
        if line.startswith("[Name:"):
            follower_status.append({"line": line_no, "text": line})
        if re.search(r"^\s*[-*]?\s*(나레이터|Narrator)\s*[:：]", line, re.IGNORECASE):
            narrator_lines.append({"line": line_no, "text": line})

    leakage = []
    normalized_current = re.sub(r"\s+", " ", current_response)
    normalized_output = re.sub(r"\s+", " ", content)
    for paragraph in normalized_paragraphs(previous_response):
        snippet = paragraph[:180]
        if snippet and snippet not in normalized_current and snippet in normalized_output:
            leakage.append(snippet)
        if len(leakage) >= 3:
            break

    return {
        "line_count": len(content.splitlines()),
        "char_count": len(content),
        "has_approval_header": bool(re.search(r"^#\s*승인됨\s*$", content, re.MULTILINE)),
        "has_record_header": bool(re.search(r"^##\s*기록\s*$", content, re.MULTILINE)),
        "markdown_status_headers": markdown_status,
        "date_status_lines": date_status,
        "follower_status_lines": follower_status,
        "narrator_line_count": len(narrator_lines),
        "previous_response_leakage_hints": leakage,
    }


def make_output_paths(out_dir: Path, prompt_path: Path, model: str, mode: str) -> dict[str, Path]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    safe_model = re.sub(r"[^A-Za-z0-9_.-]+", "_", model)
    stem = f"{prompt_path.stem}.{safe_model}.{mode}.{timestamp}"
    return {
        "payload": out_dir / f"{stem}.payload.json",
        "response": out_dir / f"{stem}.response.json",
        "content": out_dir / f"{stem}.content.txt",
        "summary": out_dir / f"{stem}.summary.json",
    }


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def print_message_table(label: str, messages: list[Message]) -> None:
    print(label)
    for output_idx, message in enumerate(messages):
        print(
            f"  out[{output_idx}] from [{message.index}] "
            f"{message.role:<9} {len(message.content):>6} chars"
        )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run quick Ollama Cloud tests for Agents! Run Inspector prompt dumps.",
    )
    parser.add_argument("prompt_file", type=Path, help="Run Inspector prompt dump text file")
    parser.add_argument(
        "--mode",
        choices=["original", "no-context-guards", "single-system", "first-system-only", "no-generated-guards"],
        default="original",
        help="Prompt transform to test",
    )
    parser.add_argument("--env-file", type=Path, default=Path(DEFAULT_ENV_FILE), help="Env file to load")
    parser.add_argument("--api-key-env", default=DEFAULT_API_KEY_ENV, help="Environment variable containing API key")
    parser.add_argument("--base-url", default=None, help="OpenAI-compatible base URL")
    parser.add_argument("--model", default=None, help="Model name, e.g. gemini-3-flash-preview:cloud")
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--max-tokens", type=int, default=None)
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--out-dir", type=Path, default=Path("/tmp"), help="Directory for payload/response outputs")
    parser.add_argument("--dry-run", action="store_true", help="Write payload and summary without calling the API")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    load_env_file(args.env_file)

    args.base_url = args.base_url or os.environ.get("OLLAMA_BASE_URL", DEFAULT_BASE_URL)
    args.model = args.model or os.environ.get("OLLAMA_MODEL", DEFAULT_MODEL)
    api_key = os.environ.get(args.api_key_env, "")

    original_messages = parse_prompt_dump(args.prompt_file)
    transformed = transform_messages(original_messages, args.mode)
    payload = build_payload(args, transformed.messages)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    paths = make_output_paths(args.out_dir, args.prompt_file, args.model, args.mode)

    write_json(paths["payload"], payload)

    summary: dict[str, object] = {
        "prompt_file": str(args.prompt_file),
        "mode": args.mode,
        "model": args.model,
        "base_url": args.base_url,
        "dry_run": args.dry_run,
        "transform_notes": transformed.notes,
        "original_messages": [
            {"index": m.index, "role": m.role, "chars": len(m.content)} for m in original_messages
        ],
        "sent_messages": [
            {"output_index": idx, "source_index": m.index, "role": m.role, "chars": len(m.content)}
            for idx, m in enumerate(transformed.messages)
        ],
        "files": {name: str(path) for name, path in paths.items()},
    }

    print_message_table("Original messages:", original_messages)
    print_message_table("Sent messages:", transformed.messages)
    for note in transformed.notes:
        print(f"note: {note}")
    print(f"payload: {paths['payload']}")

    if args.dry_run:
        write_json(paths["summary"], summary)
        print(f"summary: {paths['summary']}")
        print("dry run: API call skipped")
        return 0

    if not api_key:
        print(f"error: {args.api_key_env} is not set; add it to {args.env_file} or the environment", file=sys.stderr)
        return 2

    response = post_chat_completion(args.base_url, api_key, payload, args.timeout)
    content = extract_content(response)
    analysis = analyze_output(transformed.messages, content)

    paths["response"].write_text(json.dumps(response, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    paths["content"].write_text(content, encoding="utf-8")
    summary["usage"] = response.get("usage")
    summary["response_model"] = response.get("model")
    summary["analysis"] = analysis
    write_json(paths["summary"], summary)

    print(f"response: {paths['response']}")
    print(f"content:  {paths['content']}")
    print(f"summary:  {paths['summary']}")
    print(f"usage:    {json.dumps(response.get('usage'), ensure_ascii=False)}")
    print(f"analysis: {json.dumps(analysis, ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
