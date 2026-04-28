from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
FILES_DIR = ROOT / "files"
DATA_DIR = ROOT / "data"
MARKDOWN_DIR = DATA_DIR / "markdown"

HEADER_LINE = "序號 試題題目 解答 更新日期"
QUESTION_START_RE = re.compile(r"^\s*(\d{1,4})(?:\s+(.*)|\s*)$")
DATE_RE = r"\d{2,3}/\d{1,2}/\d{1,2}"
TRUE_FALSE_ANSWER_RE = re.compile(
    rf"^(?P<question>.+?)(?P<answer>[是否])\.?\s*(?P<updated>{DATE_RE})\s*$"
)
CHOICE_ANSWER_RE = re.compile(
    rf"^(?P<question>.+?)(?P<answer>[1234１２３４])\.?\s*(?P<updated>{DATE_RE})\s*$"
)
EMPTY_TRUE_FALSE_RE = re.compile(rf"^[是否]\.?\s*{DATE_RE}\s*$")
EMPTY_CHOICE_RE = re.compile(rf"^[1234１２３４]\.?\s*{DATE_RE}\s*$")
CHOICE_MARKER_RE = re.compile(
    r"""
    [(（〈<]\s*(?P<bracket_label>[1234１２３４]?)\s*[)）〉>]
    |(?<![\d/])(?P<bare_close_label>[1234１２３４])\)
    |(?<![\d/])(?P<bare_dot_label>[1234１２３４])\.(?=[\u4e00-\u9fffA-Za-z])
    |(?<=\s)(?P<bare_space_label>[1234１２３４])(?=[\u4e00-\u9fffA-Za-z])
    |[(（]\s*(?=[\u4e00-\u9fffA-Za-z])
    """,
    re.VERBOSE,
)
FULLWIDTH_DIGITS = str.maketrans({"１": "1", "２": "2", "３": "3", "４": "4"})
QUESTION_CUE_RE = re.compile(r"[?？]|何者|為何|何處|哪|那|幾|多少|位於|屬於")


def compact(text: str) -> str:
    text = text.replace("\u3000", " ").replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def compact_question_lines(lines: list[str]) -> str:
    # pypdf line breaks are visual wraps, not semantic breaks. Join without
    # inserting extra spaces so Chinese text and numeric units remain intact.
    return compact("".join(line.strip() for line in lines if line.strip()))


def extract_pdf_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    chunks: list[str] = []
    for page_index, page in enumerate(reader.pages, start=1):
        chunks.append(f"\n\n<!-- page {page_index} -->\n\n")
        chunks.append(page.extract_text() or "")
    return "".join(chunks)


def write_markdown_extract(pdf_path: Path, extracted_text: str) -> None:
    MARKDOWN_DIR.mkdir(parents=True, exist_ok=True)
    title = pdf_path.stem
    markdown = f"# {title}\n\n{extracted_text.strip()}\n"
    (MARKDOWN_DIR / f"{title}.md").write_text(markdown, encoding="utf-8")


def parse_filename(pdf_path: Path) -> tuple[str, str, str | None, str]:
    parts = pdf_path.stem.split("_")
    if len(parts) == 2 and parts[0] == "交通法令":
        subject = "traffic_law"
        subject_name = "交通法令"
        region = None
        raw_type = parts[1]
    elif len(parts) == 3 and parts[1] == "地理環境":
        subject = "geography"
        subject_name = "地理環境"
        region = parts[0]
        raw_type = parts[2]
    else:
        raise ValueError(f"Unsupported file name format: {pdf_path.name}")

    if raw_type == "是非題":
        question_type = "trueFalse"
    elif raw_type == "選擇題":
        question_type = "choice"
    else:
        raise ValueError(f"Unsupported question type in file name: {pdf_path.name}")

    return subject, subject_name, region, question_type


def normalize_lines(extracted_text: str, title: str) -> list[str]:
    lines: list[str] = []
    for raw_line in extracted_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("<!-- page "):
            continue
        if line == title or line == HEADER_LINE:
            continue
        lines.append(line)
    return lines


def record_has_answer(lines: list[str], question_type: str) -> bool:
    body = compact_question_lines(lines)
    if not body:
        return False
    pattern = TRUE_FALSE_ANSWER_RE if question_type == "trueFalse" else CHOICE_ANSWER_RE
    return bool(pattern.match(body))


def split_records(lines: list[str], question_type: str) -> list[tuple[int, list[str]]]:
    records: list[tuple[int, list[str]]] = []
    expected_number = 1
    current_number: int | None = None
    current_lines: list[str] = []

    for line in lines:
        match = QUESTION_START_RE.match(line)
        is_next_question = match is not None and int(match.group(1)) == expected_number

        if is_next_question and (
            current_number is None or record_has_answer(current_lines, question_type)
        ):
            if current_number is not None:
                records.append((current_number, current_lines))

            current_number = expected_number
            expected_number += 1
            rest = (match.group(2) or "").strip()
            current_lines = [rest] if rest else []
            continue

        if current_number is not None:
            current_lines.append(line)

    if current_number is not None:
        records.append((current_number, current_lines))

    return records


def split_choice_options(question: str, answer: str) -> tuple[str, list[dict[str, str]]]:
    markers: list[tuple[re.Match[str], str | None]] = []
    for match in CHOICE_MARKER_RE.finditer(question):
        raw_label = (
            match.group("bracket_label")
            or match.group("bare_close_label")
            or match.group("bare_dot_label")
            or match.group("bare_space_label")
        )
        label = raw_label.translate(FULLWIDTH_DIGITS) if raw_label else None
        markers.append((match, label))

    if len(markers) < 2:
        return question, []

    answer_number = int(answer)
    best_window: tuple[int, int, int] | None = None
    for option_count in (4, 3, 2):
        if answer_number > option_count:
            continue
        for start in range(0, len(markers) - option_count + 1):
            window = markers[start : start + option_count]
            labels = [label for _, label in window]
            stem = compact(question[: window[0][0].start()])
            option_texts = []
            for option_index, (match, _label) in enumerate(window):
                option_start = match.end()
                option_end = (
                    window[option_index + 1][0].start()
                    if option_index + 1 < len(window)
                    else len(question)
                )
                option_texts.append(compact(question[option_start:option_end]))

            score = 0
            for index, label in enumerate(labels, start=1):
                if label is None:
                    score += 0
                elif label == str(index):
                    score += 3
                else:
                    score -= 1
            if len(set(label for label in labels if label is not None)) < len(
                [label for label in labels if label is not None]
            ):
                score -= 1
            if stem:
                score += 2
            else:
                score -= 4
            if QUESTION_CUE_RE.search(stem):
                score += 5
            if any("?" in text or "？" in text for text in option_texts):
                score -= 5
            if option_count == 4:
                if "4" in labels:
                    score += 1
                elif answer_number <= 3:
                    score -= 3

            candidate = (score, option_count, start)
            if best_window is None or candidate > best_window:
                best_window = candidate

    if best_window is None or best_window[0] < 3:
        return question, []

    _, option_count, start = best_window
    selected_markers = markers[start : start + option_count]
    stem = compact(question[: selected_markers[0][0].start()])
    stem = compact(re.sub(r"^[（(]?[1-4][)）]\s*\d+\.", "", stem))
    options: list[dict[str, str]] = []
    for index, (match, _label) in enumerate(selected_markers):
        label = str(index + 1)
        start = match.end()
        end = (
            selected_markers[index + 1][0].start()
            if index + 1 < len(selected_markers)
            else len(question)
        )
        options.append({"label": label, "text": compact(question[start:end])})

    return stem, options


def parse_record(
    pdf_path: Path,
    number: int,
    lines: list[str],
    subject: str,
    subject_name: str,
    region: str | None,
    question_type: str,
) -> dict[str, object] | None:
    body = compact_question_lines(lines)
    empty_pattern = EMPTY_TRUE_FALSE_RE if question_type == "trueFalse" else EMPTY_CHOICE_RE
    if empty_pattern.match(body):
        return None

    pattern = TRUE_FALSE_ANSWER_RE if question_type == "trueFalse" else CHOICE_ANSWER_RE
    match = pattern.match(body)
    if not match:
        raise ValueError(f"Could not parse answer/date: {pdf_path.name} #{number}: {body}")

    question = compact(match.group("question"))
    answer = match.group("answer").translate(FULLWIDTH_DIGITS)
    updated = match.group("updated")
    options: list[dict[str, str]] = []

    if question_type == "choice":
        question, options = split_choice_options(question, answer)
        if not question or not options:
            return None

    region_key = region or "all"
    question_id = f"{subject}:{region_key}:{question_type}:{number}"
    return {
        "id": question_id,
        "sourceFile": pdf_path.name,
        "subject": subject,
        "subjectName": subject_name,
        "region": region,
        "type": question_type,
        "number": number,
        "text": question,
        "options": options,
        "answer": answer,
        "updated": updated,
    }


def parse_pdf(pdf_path: Path) -> list[dict[str, object]]:
    subject, subject_name, region, question_type = parse_filename(pdf_path)
    extracted_text = extract_pdf_text(pdf_path)
    write_markdown_extract(pdf_path, extracted_text)
    lines = normalize_lines(extracted_text, pdf_path.stem)
    records = split_records(lines, question_type)

    questions: list[dict[str, object]] = []
    for number, record_lines in records:
        question = parse_record(
            pdf_path,
            number,
            record_lines,
            subject,
            subject_name,
            region,
            question_type,
        )
        if question is not None:
            questions.append(question)

    actual = [int(question["number"]) for question in questions]
    if actual != sorted(set(actual)):
        raise ValueError(f"Question numbers are duplicated or out of order in {pdf_path.name}")

    return questions


def build_bank() -> dict[str, object]:
    pdf_paths = sorted(FILES_DIR.glob("*.pdf"))
    if not pdf_paths:
        raise FileNotFoundError(f"No PDF files found in {FILES_DIR}")

    questions: list[dict[str, object]] = []
    for pdf_path in pdf_paths:
        questions.extend(parse_pdf(pdf_path))

    regions = sorted(
        {
            str(question["region"])
            for question in questions
            if question["subject"] == "geography" and question["region"]
        }
    )
    sources = sorted({str(question["sourceFile"]) for question in questions})

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "paperRules": {"trueFalse": 25, "choice": 25},
        "subjects": [
            {"id": "traffic_law", "name": "交通法令", "requiresRegion": False},
            {"id": "geography", "name": "地理環境", "requiresRegion": True},
        ],
        "regions": regions,
        "sources": sources,
        "questions": questions,
    }


def write_outputs(bank: dict[str, object]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    json_text = json.dumps(bank, ensure_ascii=False, indent=2)
    (DATA_DIR / "questions.json").write_text(json_text + "\n", encoding="utf-8")
    (DATA_DIR / "questions.js").write_text(
        "window.TAXI_QUESTION_BANK = " + json_text + ";\n", encoding="utf-8"
    )


def print_summary(bank: dict[str, object]) -> None:
    questions = bank["questions"]
    counts: Counter[tuple[str, str, str]] = Counter()
    choice_without_options: list[str] = []
    for question in questions:
        subject = str(question["subjectName"])
        region = str(question["region"] or "全部")
        qtype = "是非" if question["type"] == "trueFalse" else "選擇"
        counts[(subject, region, qtype)] += 1
        if question["type"] == "choice" and not question["options"]:
            choice_without_options.append(str(question["id"]))

    print(f"Generated {len(questions)} questions from {len(bank['sources'])} PDFs.")
    for (subject, region, qtype), count in sorted(counts.items()):
        print(f"- {subject} / {region} / {qtype}: {count}")

    if choice_without_options:
        preview = ", ".join(choice_without_options[:10])
        raise ValueError(f"Choice option parsing failed for {len(choice_without_options)} questions: {preview}")


def main() -> None:
    bank = build_bank()
    write_outputs(bank)
    print_summary(bank)


if __name__ == "__main__":
    main()
