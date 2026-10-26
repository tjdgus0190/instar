#!/usr/bin/env python3
"""2027 가계부 + 카드공제 트래커 (구글 시트용 xlsx) 생성 — design.md 9장 그대로.

사용:
    python3 sheet/build_sheet.py [--out sheet/out/card-deduction-tracker-2027.xlsx]
                                 [--site-url https://<도메인>] [--contact <운영자 이메일>]
    (SITE_URL, CONTACT_EMAIL 환경변수로도 지정 가능)

생성물(xlsx)은 바이너리라 커밋하지 않는다(app/.gitignore: sheet/out/).
구글 시트 호환 규칙(design 9-1): Apps Script·ARRAYFORMULA·named range·구조화 표·체크박스 미사용,
허용 함수 IF/AND/OR/MIN/MAX/SUM/SUMIFS/ROUNDDOWN/ROUND/MONTH/TEXT/REPT/LEFT 만 사용,
시트 이름은 항상 작은따옴표로 참조, 조건부 서식은 같은 시트 셀만 참조, 데이터 유효성 목록은 인라인 문자열.

설계 대비 의도적 차이(정확도 보강, 함수 허용 목록 안):
- 최종 공제액 셀은 ROUNDDOWN(ROUND(x,4),0): 부동소수점 오차(예: 1424999.9999998)로 1원 덜 내림되는 것을 막는다.
  실제 값의 소수부는 0.25원 단위(총급여×25%)라 소수 4자리 반올림으로 정확히 복원된다.
- 25% 문턱 표시·남은 금액은 원 미만 올림(ROUNDDOWN(x+0.75,0) — 소수부가 0.25 단위라 올림과 같음).
  웹 계산기(src/calc.ts)와 같은 규칙.
- 총급여 칸이 비어 있으면 공제액 0 (빈 상태에서 숫자가 보이지 않게).
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import SOURCES  # noqa: E402

VERSION = "2026-10-26"
BANNER = "참고용 계산, 세무 자문 아님, 최종 공제액은 홈택스/회사 연말정산 결과 기준"
F3 = "2027년 카드공제 개정안이 국회 의결·법 공포되면, 공포 후 14일 이내 Gumroad 파일을 업데이트하고 구매자 이메일로 안내합니다."
SCENARIO_LABEL = "정부 개정안(국회 미통과) — 미확정 시나리오"
TOGGLE_OFF = "☐ 끔 — 현행 규칙(기본)"
TOGGLE_ON = "☑ 켬 — 정부 개정안 시나리오"

S = "'설정'!"  # 시트 참조는 항상 따옴표
LEDGER = "'2027가계부'!"
MONTHLY = "'2027월별'!"
DED = "'2027공제'!"

# ---------- 스타일 (design 9-2) ----------
def fill(hex_):
    return PatternFill(fill_type="solid", start_color=hex_, end_color=hex_)

THIN = Side(style="thin", color="D9E0DD")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
STYLES = {
    "banner": (fill("FFF4E0"), Font(color="7A4100", bold=True, size=11)),
    "title": (None, Font(color="1A1F1D", bold=True, size=14)),
    "header": (fill("1F3A33"), Font(color="FFFFFF", bold=True, size=10)),
    "input": (fill("FFF6CC"), Font(color="1A4FA0", size=10)),
    "calc": (fill("EEF2F1"), Font(color="1A1F1D", size=10)),
    "key": (fill("DDF3E8"), Font(color="0B6E4F", bold=True, size=12)),
    "muted": (None, Font(color="56615C", italic=True, size=9)),
    "scenario": (fill("FDE8E8"), Font(color="9B1C1C", bold=True, size=10)),
    "plain": (None, Font(size=10)),
}
MONEY = "#,##0"
PCT = "0%"


def style(cell, name, fmt=None, border=True, wrap=False, bold=None):
    f, font = STYLES[name]
    if f is not None:
        cell.fill = f
    if bold is not None:
        font = Font(color=font.color, bold=bold, italic=font.italic, size=font.size)
    cell.font = font
    if fmt:
        cell.number_format = fmt
    if border and name not in ("title", "muted", "banner", "plain"):
        cell.border = BORDER
    if wrap:
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    return cell


def put(ws, ref, value, name="plain", fmt=None, **kw):
    c = ws[ref]
    c.value = value
    style(c, name, fmt, **kw)
    return c


def banner(ws, last_col: str):
    ws.merge_cells(f"A1:{last_col}1")
    c = ws["A1"]
    c.value = BANNER
    style(c, "banner")
    c.alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 30


def widths(ws, spec: dict[str, float]):
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


def cf_fill(ws, rng, formula, name):
    f, font = STYLES[name]
    ws.conditional_formatting.add(rng, FormulaRule(formula=[formula], fill=f, font=Font(color=font.color, bold=font.bold)))


def cf_font(ws, rng, formula, color, bold=False):
    ws.conditional_formatting.add(rng, FormulaRule(formula=[formula], font=Font(color=color, bold=bold)))


def list_validation(ws, rng, items: str, prompt=None):
    assert len(items) <= 255, items
    dv = DataValidation(type="list", formula1=f'"{items}"', allow_blank=True, showDropDown=False)
    dv.error = "목록에서 고르세요."
    dv.errorTitle = "입력 값 확인"
    dv.showErrorMessage = True
    if prompt:
        dv.prompt = prompt
        dv.showInputMessage = True
    ws.add_data_validation(dv)
    dv.add(rng)


def money_validation(ws, rng):
    dv = DataValidation(type="whole", operator="between", formula1="0", formula2="10000000000", allow_blank=True)
    dv.error = "0 이상 100억 이하의 정수(원)를 입력하세요."
    dv.errorTitle = "금액 확인"
    dv.showErrorMessage = True
    ws.add_data_validation(dv)
    for part in rng.split():
        dv.add(part)


# ---------- 탭: 시작하기 (9-4) ----------
def build_start(ws, site_url: str, contact: str):
    ws.sheet_properties.tabColor = "7C8783"
    banner(ws, "C")
    put(ws, "B2", "2027 가계부 + 카드공제 트래커", "title")
    steps = [
        "1. 올해 남은 두 달 → '2026마무리' 탭의 노란 칸을 채우세요.",
        "2. 내년 1월부터 → '2027가계부' 탭에 지출을 한 줄씩 적으세요.",
        "3. '2027공제' 탭에 2027년 예상 총급여와 자녀 수를 넣으면 문턱 진행률과 예상 공제가 나옵니다.",
        f"4. 정부 개정안 시나리오는 '설정' 탭 C4에서만 켜고 끕니다. {SCENARIO_LABEL}",
        "5. 노란 칸만 입력하세요. 회색·초록 칸은 자동 계산입니다.",
    ]
    for i, s in enumerate(steps):
        put(ws, f"B{4 + i}", s)
    legend = [("input", "입력 칸"), ("calc", "자동 계산"), ("key", "핵심 결과"), ("scenario", "시나리오 경고")]
    for i, (name, label) in enumerate(legend):
        r = 10 + i
        put(ws, f"B{r}", label, name)
        put(ws, f"C{r}", label)
    put(ws, "B15", F3)
    put(ws, "B16", f"약속을 지키지 못하면 요청 시 전액 환불합니다. 환불정책: {site_url}/refund")
    put(ws, "B18", "이 시트는 구매자 본인용입니다. 사본 링크를 다른 사람과 공유하지 말아 주세요.")
    put(ws, "B19", f"문의: {contact} · 버전 {VERSION}")
    put(ws, "B21", "'자녀' 요건: 직계비속(손자녀·입양자·위탁아동 포함)으로 ① 연 소득금액 100만원 이하(근로소득만 있으면 총급여 500만원 이하) ② 20세 이하(장애인은 나이 무관) ③ 다른 사람의 기본공제를 받지 않을 것 — 셋 다 충족.", "muted")
    widths(ws, {"A": 3, "B": 22, "C": 90})


# ---------- 탭: 설정 (9-5) ----------
SETTINGS_ROWS = [
    # 행, 키, 항목, 현행, 개정안, 단위, 출처
    (8, "MIN_RATE", "최저사용금액 비율", 25, 25, "%", "A1-1"),
    (9, "R_CREDIT", "신용카드 공제율", 15, 15, "%", "A1-2"),
    (10, "R_DEBIT", "체크·현금영수증 공제율", 30, 30, "%", "A1-3"),
    (11, "R_MARKET", "전통시장(·별도 공제 시 대중교통) 공제율", 40, 40, "%", "A1-4,5"),
    (12, "TRANSIT_SEP", "대중교통 별도 공제(1=40%·추가한도 포함, 0=결제수단별·추가한도 제외)", 1, 0, "1/0", "A2-P1"),
    (13, "R_CULTURE", "문화체육 공제율", 30, 30, "%", "A1-6"),
    (14, "CULTURE_CAP", "문화체육 총급여 상한(0=제한 없음)", 70000000, 0, "원", "A1-6, A2-P2"),
    (15, "G_SPLIT", "총급여 구간 기준(이하)", 70000000, 70000000, "원", "A1-8"),
    (16, "BASIC_LOW", "기본 한도(구간 이하)", 3000000, 3000000, "원", "A1-8"),
    (17, "BASIC_HIGH", "기본 한도(구간 초과)", 2500000, 2500000, "원", "A1-8"),
    (18, "CHILD_LOW", "자녀 1명당 가산(이하)", 500000, 500000, "원", "A1-9"),
    (19, "CHILD_HIGH", "자녀 1명당 가산(초과)", 250000, 250000, "원", "A1-9"),
    (20, "CHILD_MAX", "자녀 가산 최대 인원", 2, 2, "명", "A1-9"),
    (21, "EXTRA_LOW", "추가 한도(이하)", 3000000, 2000000, "원", "A1-11, A2-P3"),
    (22, "EXTRA_HIGH", "추가 한도(초과)", 2000000, 1000000, "원", "A1-11, A2-P3"),
]


def build_settings(ws):
    ws.sheet_properties.tabColor = "1F3A33"
    banner(ws, "G")
    put(ws, "B2", "설정 — 공제 규칙 변수", "title")
    put(ws, "B4", "정부 개정안 시나리오", "plain", bold=True)
    ws["B4"].font = Font(bold=True, size=10)
    c4 = put(ws, "C4", TOGGLE_OFF, "input")
    c4.font = Font(color="1A4FA0", bold=True, size=10)
    list_validation(ws, "C4", f"{TOGGLE_OFF},{TOGGLE_ON}")
    put(ws, "D4", SCENARIO_LABEL, "scenario")
    put(ws, "B5", "시나리오 적용(자동)")
    put(ws, "C5", '=IF(LEFT(C4,1)="☑",1,0)', "calc")
    put(ws, "D5", "켜면 '2027공제' 탭만 개정안 값으로 계산합니다. '2026마무리' 탭은 항상 현행 규칙입니다.", "muted")
    for col, h in zip("ABCDEFG", ["키", "항목", "현행 규칙(2026 사용분)", "정부 개정안(미확정)", "2027공제 적용값", "단위", "출처 번호"]):
        put(ws, f"{col}7", h, "header")
    for r, key, label, cur, prop, unit, src in SETTINGS_ROWS:
        fmt = MONEY if unit == "원" else "0"
        put(ws, f"A{r}", key, "calc")
        put(ws, f"B{r}", label, "calc", wrap=True)
        put(ws, f"C{r}", cur, "calc", fmt)
        put(ws, f"D{r}", prop, "calc", fmt)
        put(ws, f"E{r}", f"=IF($C$5=1,D{r},C{r})", "calc", fmt)
        put(ws, f"F{r}", unit, "calc")
        put(ws, f"G{r}", src, "calc")
    cf_fill(ws, "D8:D22", "$C$5=1", "scenario")
    cf_fill(ws, "C8:C22", "$C$5=0", "key")

    put(ws, "A24", "출처 (brief.md 부록 A, 확인일 2026-10-26)", "plain")
    ws["A24"].font = Font(bold=True, size=10)
    for col, h in zip("ABCDE", ["번호", "항목", "값", "출처 URL", "확인일"]):
        put(ws, f"{col}25", h, "header")
    for i, (num, item, val, url) in enumerate(SOURCES):
        r = 26 + i
        put(ws, f"A{r}", num, "calc")
        put(ws, f"B{r}", item, "calc", wrap=True)
        put(ws, f"C{r}", val, "calc", wrap=True)
        put(ws, f"D{r}", url, "calc", wrap=True)  # 텍스트(HYPERLINK 미사용)
        put(ws, f"E{r}", "2026-10-26", "calc")
    widths(ws, {"A": 14, "B": 46, "C": 22, "D": 22, "E": 18, "F": 8, "G": 14})


# ---------- 탭: 2026마무리 (9-6) ----------
def ded_block_formulas(col: str) -> dict[int, str]:
    """2026마무리 계산 과정 34~40행 (col = C 또는 D)."""
    c = col
    rc, rd, rm, rcu = f"{S}$C$9", f"{S}$C$10", f"{S}$C$11", f"{S}$C$13"
    return {
        33: f"={c}28+{c}29+{c}30+{c}31",
        34: f"=({c}28*{rc}+{c}29*{rd}+{c}30*{rcu}+{c}31*{rm})/100",
        35: (f"=IF({c}28>={c}32,{c}32*{rc}/100,IF({c}28+{c}29+{c}30>={c}32,{c}28*{rc}/100+({c}32-{c}28)*{rd}/100,"
             f"{c}28*{rc}/100+({c}29+{c}30)*{rd}/100+({c}32-{c}28-{c}29-{c}30)*{rm}/100))"),
        36: f"=IF({c}33<={c}32,0,{c}34-{c}35)",
        39: f"={c}31*{rm}/100+{c}30*{rcu}/100",
        40: f'=IF($C$5="",0,IF({c}36<={c}37,ROUNDDOWN(ROUND({c}36,4),0),ROUNDDOWN(ROUND({c}37+MIN({c}36-{c}37,{c}39,{c}38),4),0)))',
    }


def build_2026(ws):
    ws.sheet_properties.tabColor = "0B6E4F"
    banner(ws, "E")
    put(ws, "B2", "2026년 11~12월 마무리 — 체크카드로 바꿔야 할까", "title")
    for col in "BCDE":
        put(ws, f"{col}4", "입력" if col == "B" else None, "header")
    inputs = [
        (5, "올해 총급여", "연봉에서 비과세 수당을 뺀 금액. 모르면 연봉."),
        (6, "지금까지 신용카드", "홈택스 미리보기 1~9월 + 10월. 전통시장·대중교통·문화비 제외."),
        (7, "지금까지 체크카드 + 현금영수증", "같은 기준."),
        (8, "지금까지 전통시장", "결제수단 무관."),
        (9, "지금까지 대중교통", "결제수단 무관."),
        (10, "지금까지 문화체육(도서·공연·영화·체육시설 등)", "총급여 7천만원 이하만 별도 30%. 초과면 0으로 두고 신용/체크 칸에 넣으세요."),
        (11, "20세 이하 자녀·손자녀 수", "2 = 2명 이상. 요건은 '시작하기' 참고."),
        (12, "11~12월 예상 지출(일반)", "세금·관리비·통신비 등 공제 제외 지출은 빼세요."),
    ]
    for r, label, help_ in inputs:
        put(ws, f"B{r}", label, "plain")
        put(ws, f"C{r}", 0 if r == 11 else None, "input", "0" if r == 11 else MONEY)
        put(ws, f"E{r}", help_, "muted")
    list_validation(ws, "C11", "0,1,2")
    money_validation(ws, "C5:C10 C12")

    for col in "BCDE":
        put(ws, f"{col}14", "결과" if col == "B" else None, "header")
    results = [
        (15, "25% 문턱(최저사용금액)", "=ROUNDDOWN(C32+0.75,0)", "calc"),
        (16, "문턱까지 남은 금액(지금)", "=MAX(0,ROUNDDOWN(C32-(C6+C7+C30+C31)+0.75,0))", "calc"),
        (17, "11~12월 지출 후에도 남는 금액", "=MAX(0,ROUNDDOWN(C32-(C6+C7+C30+C31+C12)+0.75,0))", "calc"),
        (18, "기본 한도", "=C37", "calc"),
        (19, "추가 한도", "=C38", "calc"),
        (20, "남은 지출을 신용카드로 쓸 때 공제", "=C40", "key"),
        (21, "남은 지출을 체크카드·현금영수증으로 쓸 때 공제", "=D40", "key"),
        (22, "차이(체크 − 신용)", "=D40-C40", "key"),
    ]
    for r, label, f, st in results:
        put(ws, f"B{r}", label)
        put(ws, f"C{r}", f, st, MONEY)
    put(ws, "B23", "결과")
    ws.merge_cells("C23:E23")
    result_formula = (
        '=IF(C5="","노란 칸을 채우면 결과가 나옵니다.",'
        'IF(C17>0,"11~12월 지출을 다 써도 25% 문턱에 "&TEXT(C17,"#,##0")&"원 못 미칩니다. 문턱 아래 지출은 결제수단과 상관없이 공제가 없어요.",'
        'IF(AND(C22=0,C20>=C18),"이미 공제 한도에 도달해 체크카드로 바꿔도 공제액이 같습니다. 혜택 좋은 신용카드를 쓰세요.",'
        'IF(C22=0,"남은 지출은 대부분 25% 문턱을 채우는 데 쓰여 결제수단에 따른 차이가 없습니다.",'
        '"남은 "&TEXT(C12,"#,##0")&"원을 체크카드·현금영수증으로 쓰면 소득공제가 "&TEXT(C22,"#,##0")&"원 늘어납니다 (신용 "&TEXT(C20,"#,##0")&"원 → 체크 "&TEXT(C21,"#,##0")&"원)."))))'
    )
    put(ws, "C23", result_formula, "key", wrap=True)
    ws.row_dimensions[23].height = 48
    ws.merge_cells("C24:E24")
    put(ws, "C24", "소득공제액 기준. 실제 줄어드는 세금은 공제액 × 본인 세율(지방소득세 포함)이라 이보다 작습니다. 소비증가분 특례·종합한도는 계산에 포함하지 않음", "muted", wrap=True)
    ws.row_dimensions[24].height = 30
    ws.merge_cells("C25:E25")
    put(ws, "C25", f'=IF(AND(C10>0,C5>{S}$C$15),"총급여 7천만원 초과: 문화비는 별도 공제율이 없어 계산에서 뺐습니다. 신용/체크 칸에 더해 입력하세요.","")', "plain", wrap=True)
    cf_fill(ws, "C25", 'C25<>""', "scenario")
    cf_font(ws, "C22", "C22>0", "0B6E4F", bold=True)
    ws.conditional_formatting.add("C16", FormulaRule(formula=["C16>0"], fill=fill("FFF4E0")))

    # 계산 과정
    put(ws, "B26", "계산 과정 — 수정하지 마세요", "muted")
    put(ws, "C27", "남은 지출 신용카드", "header")
    put(ws, "D27", "남은 지출 체크카드", "header")
    labels = {28: "신용 c", 29: "체크·현금 d", 30: "문화체육 s", 31: "전통시장+대중교통 t", 32: "최저사용금액 M", 33: "합계",
              34: "공제율 적용액", 35: "문턱 차감액", 36: "일반 공제대상 base", 37: "기본 한도", 38: "추가 한도", 39: "추가공제 대상", 40: "공제액"}
    for r, l in labels.items():
        put(ws, f"B{r}", l, "muted")
    fixed = {
        28: ("=$C$6+$C$12", "=$C$6"),
        29: ("=$C$7", "=$C$7+$C$12"),
        30: (f"=IF($C$5<={S}$C$14,$C$10,0)", "=C30"),
        31: ("=$C$8+$C$9", "=C31"),
        32: (f"=$C$5*{S}$C$8/100", "=C32"),
        37: (f"=IF($C$5<={S}$C$15,{S}$C$16+MIN($C$11+0,{S}$C$20)*{S}$C$18,{S}$C$17+MIN($C$11+0,{S}$C$20)*{S}$C$19)", "=C37"),
        38: (f"=IF($C$5<={S}$C$15,{S}$C$21,{S}$C$22)", "=C38"),
    }
    for r, (fc, fd) in fixed.items():
        put(ws, f"C{r}", fc, "calc", MONEY)
        put(ws, f"D{r}", fd, "calc", MONEY)
    for col in "CD":
        for r, f in ded_block_formulas(col).items():
            put(ws, f"{col}{r}", f, "key" if r == 40 else "calc", MONEY)
    widths(ws, {"A": 3, "B": 34, "C": 18, "D": 18, "E": 60})


# ---------- 탭: 2027가계부 (9-7) ----------
LEDGER_FIRST, LEDGER_LAST = 5, 1004
CATEGORIES = "식비,카페·간식,생활용품,교통,주거·관리비,통신,의료,교육,문화·여가,경조사,쇼핑,기타,급여,부수입,기타수입"
METHODS = "신용카드,체크·현금영수증,전통시장,대중교통(신용),대중교통(체크),문화체육,현금(영수증 없음),공제 제외"


def build_ledger(ws):
    ws.sheet_properties.tabColor = "F2C94C"
    banner(ws, "H")
    put(ws, "A2", "2027 가계부 — 한 줄에 한 건", "title")
    put(ws, "A3", "노란 칸만 입력하세요. 세금·관리비·통신비·보험료·해외 사용분은 결제수단을 '공제 제외'로. 총급여 7천만원 초과면 문화비는 '신용카드' 또는 '체크·현금영수증'으로 고르세요.", "muted")
    heads = ["날짜", "월", "구분", "카테고리", "결제수단", "금액", "카드공제", "메모"]
    for i, h in enumerate(heads):
        put(ws, f"{get_column_letter(i + 1)}4", h, "header")
    for r in range(LEDGER_FIRST, LEDGER_LAST + 1):
        style(ws.cell(r, 1), "input", "yyyy-mm-dd")
        ws.cell(r, 2).value = f'=IF(A{r}="","",MONTH(A{r}))'
        style(ws.cell(r, 2), "calc", "0")
        style(ws.cell(r, 3), "input")
        style(ws.cell(r, 4), "input")
        style(ws.cell(r, 5), "input")
        style(ws.cell(r, 6), "input", MONEY)
        ws.cell(r, 7).value = f'=IF(OR(C{r}<>"지출",E{r}=""),"",IF(OR(E{r}="현금(영수증 없음)",E{r}="공제 제외"),"제외","포함"))'
        style(ws.cell(r, 7), "calc")
        style(ws.cell(r, 8), "input")
    rng = lambda col: f"{col}{LEDGER_FIRST}:{col}{LEDGER_LAST}"
    dv = DataValidation(type="date", operator="between", formula1="DATE(2027,1,1)", formula2="DATE(2027,12,31)", allow_blank=True)
    dv.error = "2027-01-01 ~ 2027-12-31 날짜를 입력하세요."
    dv.errorTitle = "날짜 확인"
    dv.showErrorMessage = True
    ws.add_data_validation(dv)
    dv.add(rng("A"))
    list_validation(ws, rng("C"), "지출,수입")
    list_validation(ws, rng("D"), CATEGORIES)
    list_validation(ws, rng("E"), METHODS)
    money_validation(ws, rng("F"))
    cf_font(ws, rng("G"), f'G{LEDGER_FIRST}="제외"', "56615C")
    cf_font(ws, f"A{LEDGER_FIRST}:H{LEDGER_LAST}", f'$C{LEDGER_FIRST}="수입"', "1A4FA0")
    ws.freeze_panes = "A5"
    widths(ws, {"A": 12, "B": 6, "C": 8, "D": 14, "E": 18, "F": 14, "G": 10, "H": 30})


# ---------- 탭: 2027월별 (9-8) ----------
def build_monthly(ws):
    ws.sheet_properties.tabColor = "7C8783"
    banner(ws, "O")
    put(ws, "A2", "2027 월별 결제수단 누적 — 자동 계산", "title")
    put(ws, "N2", "2027 문턱(25%)", "plain")
    put(ws, "O2", f"={DED}$C$17", "calc", MONEY)
    heads = ["월", "수입", "지출 합계", "신용카드", "체크·현금영수증", "전통시장", "대중교통(신용)", "대중교통(체크)", "문화체육",
             "현금(영수증 없음)", "공제 제외", "공제 대상 누적", "25% 문턱 진행률", "진행 막대"]
    for i, h in enumerate(heads):
        put(ws, f"{get_column_letter(i + 1)}4", h, "header", wrap=True)
    F = f"{LEDGER}$F${LEDGER_FIRST}:$F${LEDGER_LAST}"
    B = f"{LEDGER}$B${LEDGER_FIRST}:$B${LEDGER_LAST}"
    C = f"{LEDGER}$C${LEDGER_FIRST}:$C${LEDGER_LAST}"
    E = f"{LEDGER}$E${LEDGER_FIRST}:$E${LEDGER_LAST}"
    method_cols = {"D": "신용카드", "E": "체크·현금영수증", "F": "전통시장", "G": "대중교통(신용)", "H": "대중교통(체크)",
                   "I": "문화체육", "J": "현금(영수증 없음)", "K": "공제 제외"}
    for m in range(1, 13):
        r = 4 + m
        put(ws, f"A{r}", m, "calc", "0")
        put(ws, f"B{r}", f'=SUMIFS({F},{B},$A{r},{C},"수입")', "calc", MONEY)
        put(ws, f"C{r}", f'=SUMIFS({F},{B},$A{r},{C},"지출")', "calc", MONEY)
        for col, method in method_cols.items():
            put(ws, f"{col}{r}", f'=SUMIFS({F},{B},$A{r},{C},"지출",{E},"{method}")', "calc", MONEY)
        put(ws, f"L{r}", f"=SUM($D$5:$I{r})", "calc", MONEY)
        put(ws, f"M{r}", f'=IF($O$2=0,"",MIN(1,L{r}/$O$2))', "calc", PCT)
        put(ws, f"N{r}", f'=IF(M{r}="","",REPT("■",ROUNDDOWN(M{r}*10,0))&REPT("□",10-ROUNDDOWN(M{r}*10,0)))', "calc")
    put(ws, "A17", "합계", "key")
    for col in "BCDEFGHIJK":
        put(ws, f"{col}17", f"=SUM({col}5:{col}16)", "key", MONEY)
    put(ws, "L17", "=L16", "key", MONEY)
    put(ws, "M17", "=M16", "key", PCT)
    put(ws, "N17", "=N16", "key")
    cf_fill(ws, "M5:M16", "AND($O$2>0,M5>=1)", "key")
    ws.freeze_panes = "B5"
    w = {"A": 6, "M": 10, "N": 14, "O": 14}
    w.update({c: 13 for c in "BCDEFGHIJKL"})
    widths(ws, w)


# ---------- 탭: 2027공제 (9-9) ----------
def build_deduction(ws):
    ws.sheet_properties.tabColor = "0B6E4F"
    banner(ws, "E")
    ws.merge_cells("B2:E2")
    put(ws, "B2", f'=IF($H$2=1,"{SCENARIO_LABEL}로 계산 중. 끄려면 \'설정\' 탭 C4","현행 규칙(2026 사용분 기준)으로 계산 중")', "calc")
    cf_fill(ws, "B2:E2", "$H$2=1", "scenario")
    put(ws, "H2", f"={S}$C$5", "plain")
    ws["H2"].font = Font(color="FFFFFF", size=10)
    ws.column_dimensions["H"].hidden = True

    for col in "BCDE":
        put(ws, f"{col}4", "입력" if col == "B" else None, "header")
    put(ws, "B5", "2027년 예상 총급여")
    put(ws, "C5", None, "input", MONEY)
    money_validation(ws, "C5")
    put(ws, "B6", "20세 이하 자녀·손자녀 수")
    put(ws, "C6", 0, "input", "0")
    list_validation(ws, "C6", "0,1,2")

    for col in "BCDE":
        put(ws, f"{col}8", "누적 사용액 ('2027가계부'에서 자동)" if col == "B" else None, "header")
    for r, (label, col) in zip(range(9, 15), [("신용카드", "D"), ("체크·현금영수증", "E"), ("전통시장", "F"),
                                              ("대중교통(신용)", "G"), ("대중교통(체크)", "H"), ("문화체육", "I")]):
        put(ws, f"B{r}", label)
        put(ws, f"C{r}", f"={MONTHLY}{col}17", "calc", MONEY)

    for col in "BCDE":
        put(ws, f"{col}16", "결과" if col == "B" else None, "header")
    rows = [
        (17, "25% 문턱", "=ROUNDDOWN(C35+0.75,0)", "calc", MONEY),
        (18, "공제 대상 누적 합계", "=C36", "calc", MONEY),
        (19, "문턱 진행률", '=IF(C17=0,"",MIN(1,C18/C17))', "calc", PCT),
        (20, "문턱까지 남은 금액", "=MAX(0,C17-C18)", "key", MONEY),
        (21, "지금까지 예상 카드 소득공제", "=C43", "key", MONEY),
        (22, "기본 한도", "=C40", "calc", MONEY),
        (23, "추가 한도", "=C41", "calc", MONEY),
        (24, "기본 한도까지 남은 공제", "=MAX(0,C22-MIN(C21,C22))", "calc", MONEY),
    ]
    for r, label, f, st, fmt in rows:
        put(ws, f"B{r}", label)
        put(ws, f"C{r}", f, st, fmt)
    put(ws, "D19", '=IF(C19="","",REPT("■",ROUNDDOWN(C19*10,0))&REPT("□",10-ROUNDDOWN(C19*10,0)))', "calc")
    put(ws, "B25", "다음 지출 추천")
    ws.merge_cells("C25:E25")
    put(ws, "C25", (
        '=IF(C5="","노란 칸에 2027년 예상 총급여를 넣으세요.",'
        'IF(C20>0,"문턱 전: 아직 공제가 없는 구간이에요. 결제수단보다 할인·적립이 좋은 카드를 쓰세요.",'
        'IF(C21<C22,"문턱 통과: 지금부터는 체크카드·현금영수증이 공제에 유리해요(신용 15%, 체크 30%).",'
        '"기본 한도 도달: 혜택 좋은 신용카드를 쓰세요. 전통시장 등 추가 한도 대상 지출은 더 공제될 수 있어요.")))'
    ), "key", wrap=True)
    ws.row_dimensions[25].height = 40
    put(ws, "B26", "적용 규칙")
    put(ws, "C26", f'=IF($H$2=1,"{SCENARIO_LABEL}","현행 규칙")', "calc")
    put(ws, "B27", "경고(문화비)")
    ws.merge_cells("C27:E27")
    put(ws, "C27", '=IF(AND(C14>0,C32=0),"총급여 7천만원 초과(현행 규칙): 문화비는 별도 공제율이 없어 계산에서 뺐습니다. 가계부에서 \'신용카드\' 또는 \'체크·현금영수증\'으로 바꿔 입력하세요.","")', "plain", wrap=True)
    cf_fill(ws, "C27", 'C27<>""', "scenario")

    put(ws, "B29", "계산 과정 — 수정하지 마세요", "muted")
    E = lambda n: f"{S}$E${n}"
    calc = {
        30: ("신용 c", f"=C9+IF({E(12)}=0,C12,0)"),
        31: ("체크·현금 d", f"=C10+IF({E(12)}=0,C13,0)"),
        32: ("문화체육 s", f"=IF(OR({E(14)}=0,$C$5<={E(14)}),C14,0)"),
        33: ("전통시장(+대중교통) t", f"=C11+IF({E(12)}=1,C12+C13,0)"),
        34: ("(예비)", None),
        35: ("최저사용금액 M", f"=$C$5*{E(8)}/100"),
        36: ("합계", "=C30+C31+C32+C33"),
        37: ("공제율 적용액", f"=(C30*{E(9)}+C31*{E(10)}+C32*{E(13)}+C33*{E(11)})/100"),
        38: ("문턱 차감액", (f"=IF(C30>=C35,C35*{E(9)}/100,IF(C30+C31+C32>=C35,C30*{E(9)}/100+(C35-C30)*{E(10)}/100,"
                          f"C30*{E(9)}/100+(C31+C32)*{E(10)}/100+(C35-C30-C31-C32)*{E(11)}/100))")),
        39: ("base", "=IF(C36<=C35,0,C37-C38)"),
        40: ("기본 한도", f"=IF($C$5<={E(15)},{E(16)}+MIN($C$6+0,{E(20)})*{E(18)},{E(17)}+MIN($C$6+0,{E(20)})*{E(19)})"),
        41: ("추가 한도", f"=IF($C$5<={E(15)},{E(21)},{E(22)})"),
        42: ("추가공제 대상", f"=C33*{E(11)}/100+IF($C$5<={E(15)},C32*{E(13)}/100,0)"),
        43: ("공제액", '=IF($C$5="",0,IF(C39<=C40,ROUNDDOWN(ROUND(C39,4),0),ROUNDDOWN(ROUND(C40+MIN(C39-C40,C42,C41),4),0)))'),
    }
    for r, (label, f) in calc.items():
        put(ws, f"B{r}", label, "muted")
        put(ws, f"C{r}", f if f else "—", "key" if r == 43 else "calc", MONEY)
    widths(ws, {"A": 3, "B": 34, "C": 18, "D": 16, "E": 40})


def build(out: Path, site_url: str, contact: str) -> Path:
    wb = Workbook()
    start = wb.active
    start.title = "시작하기"
    s2026 = wb.create_sheet("2026마무리")
    ledger = wb.create_sheet("2027가계부")
    monthly = wb.create_sheet("2027월별")
    ded = wb.create_sheet("2027공제")
    settings = wb.create_sheet("설정")
    build_start(start, site_url, contact)
    build_2026(s2026)
    build_ledger(ledger)
    build_monthly(monthly)
    build_deduction(ded)
    build_settings(settings)
    wb.active = 1  # 2026마무리부터 보이게
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = ws.title == "2026마무리"
    wb.properties.title = "2027 가계부 + 카드공제 트래커"
    wb.properties.creator = "카드공제 계산기"
    wb.properties.created = dt.datetime(2026, 10, 26)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default=str(Path(__file__).resolve().parent / "out" / "card-deduction-tracker-2027.xlsx"))
    p.add_argument("--site-url", default=os.environ.get("SITE_URL", ""))
    p.add_argument("--contact", default=os.environ.get("CONTACT_EMAIL", ""))
    a = p.parse_args()
    site = a.site_url.rstrip("/")
    if not site or "example.pages.dev" in site:
        print("경고: SITE_URL 미설정 — '시작하기' 탭 환불정책 URL이 <도메인> 으로 들어갑니다. 판매용 생성 전 지정하세요.", file=sys.stderr)
        site = "https://<도메인>"
    contact = a.contact or "<운영자 이메일>"
    if not a.contact:
        print("경고: CONTACT_EMAIL 미설정 — '시작하기' 탭 문의 메일이 <운영자 이메일> 으로 들어갑니다.", file=sys.stderr)
    out = build(Path(a.out), site, contact)
    print(out)


if __name__ == "__main__":
    main()
