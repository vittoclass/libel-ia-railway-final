"""
Calibración geométrica completa para la plantilla estándar LibelIA.
Toda la grilla se deriva de esta configuración; no hay números mágicos en omr_engine.
Alineado con app/lib/omr-sheet-spec.ts.
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class TemplateConfig:
    """Configuración única de plantilla estándar LibelIA. Todas las medidas en mm salvo px."""

    # —— Página (A4) ——
    PAGE_WIDTH_MM: float = 210.0
    PAGE_HEIGHT_MM: float = 297.0

    # —— Resolución del warp (tamaño fijo en píxeles) ——
    PX_PER_MM: float = 4.0

    # —— Geometría del contenido (área interior dentro de marcadores) ——
    MARGIN_MM: float = 15.0
    MARKER_SIZE_MM: float = 12.0
    CONTENT_WIDTH_MM: float = field(init=False)
    CONTENT_HEIGHT_MM: float = field(init=False)
    INNER_LEFT_MM: float = field(init=False)
    INNER_TOP_MM: float = field(init=False)
    INNER_WIDTH_MM: float = field(init=False)
    INNER_HEIGHT_MM: float = field(init=False)

    # —— Grilla de preguntas ——
    COLUMNS: int = 2
    HEADER_HEIGHT_MM: float = 28.0
    QUESTION_NUMBER_WIDTH_MM: float = 8.0
    START_Y_MM: float = field(init=False)  # inicio primera fila de respuestas (centro vertical de fila)
    ROW_HEIGHT_MM: float = 6.0
    COLUMN_GAP_MM: float = 0.0  # gap entre columnas (derivado de INNER_WIDTH_MM/COLUMNS)
    COL_WIDTH_MM: float = field(init=False)
    COL1_X_MM: float = field(init=False)  # inicio X primera burbuja columna 0
    COL2_X_MM: float = field(init=False)  # inicio X primera burbuja columna 1

    # —— Burbujas ——
    BUBBLE_WIDTH_MM: float = 4.0
    BUBBLE_HEIGHT_MM: float = 4.0
    BUBBLE_SPACING_MM: float = 6.0
    ROI_MARGIN_MM: float = 0.5  # margen interior para evitar borde impreso (inner ROI)

    # —— Umbrales de lectura (calibración) ——
    INNER_FILL_RATIO_THRESHOLD: float = 0.22
    DOUBLE_MARK_DELTA: float = 0.18
    MIN_FILLED_AREA_RATIO: float = 0.20
    MAX_EMPTY_AREA_RATIO: float = 0.85
    DARK_PIXEL_THRESHOLD: int = 127  # píxel < este valor = oscuro

    # —— Opciones por defecto ——
    DEFAULT_OPTION_LABELS: tuple[str, ...] = ("A", "B", "C", "D")

    @property
    def WARP_WIDTH_PX(self) -> int:
        return int(self.PAGE_WIDTH_MM * self.PX_PER_MM)

    @property
    def WARP_HEIGHT_PX(self) -> int:
        return int(self.PAGE_HEIGHT_MM * self.PX_PER_MM)

    def __post_init__(self) -> None:
        object.__setattr__(self, "CONTENT_WIDTH_MM", self.PAGE_WIDTH_MM - 2 * self.MARGIN_MM)
        object.__setattr__(self, "CONTENT_HEIGHT_MM", self.PAGE_HEIGHT_MM - 2 * self.MARGIN_MM)
        object.__setattr__(self, "INNER_LEFT_MM", self.MARGIN_MM + self.MARKER_SIZE_MM)
        object.__setattr__(self, "INNER_TOP_MM", self.MARGIN_MM + self.MARKER_SIZE_MM)
        object.__setattr__(self, "INNER_WIDTH_MM", self.CONTENT_WIDTH_MM - 2 * self.MARKER_SIZE_MM)
        object.__setattr__(self, "INNER_HEIGHT_MM", self.CONTENT_HEIGHT_MM - 2 * self.MARKER_SIZE_MM)
        object.__setattr__(self, "START_Y_MM", self.INNER_TOP_MM + self.HEADER_HEIGHT_MM + self.ROW_HEIGHT_MM / 2)
        object.__setattr__(self, "COL_WIDTH_MM", self.INNER_WIDTH_MM / self.COLUMNS)
        object.__setattr__(self, "COL1_X_MM", self.INNER_LEFT_MM + self.QUESTION_NUMBER_WIDTH_MM)
        object.__setattr__(self, "COL2_X_MM", self.INNER_LEFT_MM + self.COL_WIDTH_MM + self.QUESTION_NUMBER_WIDTH_MM)


# Instancia global para plantilla estándar LibelIA
LIBELIA_STANDARD = TemplateConfig()


def get_warp_size_px(config: Optional[TemplateConfig] = None) -> tuple[int, int]:
    """Tamaño en píxeles del warp (ancho, alto)."""
    c = config or LIBELIA_STANDARD
    w = int(c.PAGE_WIDTH_MM * c.PX_PER_MM)
    h = int(c.PAGE_HEIGHT_MM * c.PX_PER_MM)
    return w, h


def mm_to_px(mm: float, config: Optional[TemplateConfig] = None) -> int:
    return int(mm * (config or LIBELIA_STANDARD).PX_PER_MM)


def _start_x_mm_per_column(config: TemplateConfig, num_options: int) -> list[float]:
    """X inicial (mm) por columna: inicio del primer centro de burbuja en esa columna."""
    out: list[float] = []
    for col in range(config.COLUMNS):
        x_base = config.INNER_LEFT_MM + col * config.COL_WIDTH_MM + config.QUESTION_NUMBER_WIDTH_MM
        out.append(x_base)
    return out


def get_questions_per_column(num_questions: int, config: Optional[TemplateConfig] = None) -> int:
    """Preguntas por columna (techo de num_questions / COLUMNS)."""
    c = config or LIBELIA_STANDARD
    return (num_questions + c.COLUMNS - 1) // c.COLUMNS


def get_bubble_rects_mm(
    num_questions: int,
    num_options: int,
    config: Optional[TemplateConfig] = None,
) -> list[tuple[int, int, float, float, float, float]]:
    """
    Para cada burbuja: (question_1based, option_index, x1_mm, y1_mm, x2_mm, y2_mm).
    Rectángulo exterior de la burbuja (centro ± mitad ancho/alto).
    """
    c = config or LIBELIA_STANDARD
    half_w = c.BUBBLE_WIDTH_MM / 2
    half_h = c.BUBBLE_HEIGHT_MM / 2
    start_x_cols = _start_x_mm_per_column(c, num_options)
    out: list[tuple[int, int, float, float, float, float]] = []
    for q in range(1, num_questions + 1):
        col = (q - 1) % c.COLUMNS
        row = (q - 1) // c.COLUMNS
        cx_mm = start_x_cols[col] + 0  # primera burbuja de la fila
        cy_mm = c.START_Y_MM + row * c.ROW_HEIGHT_MM
        for o in range(num_options):
            cx = cx_mm + o * c.BUBBLE_SPACING_MM
            x1 = cx - half_w
            y1 = cy_mm - half_h
            x2 = cx + half_w
            y2 = cy_mm + half_h
            out.append((q, o, x1, y1, x2, y2))
    return out


def get_bubble_inner_rects_mm(
    num_questions: int,
    num_options: int,
    config: Optional[TemplateConfig] = None,
) -> list[tuple[int, int, float, float, float, float]]:
    """
    Igual que get_bubble_rects_mm pero restando ROI_MARGIN_MM por lado (inner ROI).
    """
    c = config or LIBELIA_STANDARD
    m = c.ROI_MARGIN_MM
    rects = get_bubble_rects_mm(num_questions, num_options, config)
    return [
        (q, o, x1 + m, y1 + m, x2 - m, y2 - m)
        for (q, o, x1, y1, x2, y2) in rects
    ]


def get_bubble_rects_px(
    num_questions: int,
    num_options: int,
    config: Optional[TemplateConfig] = None,
) -> list[tuple[int, int, int, int, int, int]]:
    """Cada burbuja en píxeles: (q, option_index, x1_px, y1_px, x2_px, y2_px)."""
    c = config or LIBELIA_STANDARD
    rects_mm = get_bubble_rects_mm(num_questions, num_options, config)
    out: list[tuple[int, int, int, int, int, int]] = []
    for (q, o, x1, y1, x2, y2) in rects_mm:
        out.append((
            q, o,
            mm_to_px(x1, c), mm_to_px(y1, c),
            mm_to_px(x2, c), mm_to_px(y2, c),
        ))
    return out


def get_bubble_inner_rects_px(
    num_questions: int,
    num_options: int,
    config: Optional[TemplateConfig] = None,
) -> list[tuple[int, int, int, int, int, int]]:
    """Inner ROI en píxeles."""
    c = config or LIBELIA_STANDARD
    rects_mm = get_bubble_inner_rects_mm(num_questions, num_options, config)
    out: list[tuple[int, int, int, int, int, int]] = []
    for (q, o, x1, y1, x2, y2) in rects_mm:
        out.append((
            q, o,
            mm_to_px(x1, c), mm_to_px(y1, c),
            mm_to_px(x2, c), mm_to_px(y2, c),
        ))
    return out


def get_grid_lines_px(
    num_questions: int,
    num_options: int,
    config: Optional[TemplateConfig] = None,
) -> list[tuple[tuple[int, int], tuple[int, int]]]:
    """Líneas de la grilla para dibujar: lista de ((x1,y1), (x2,y2)) en px."""
    c = config or LIBELIA_STANDARD
    w_px, h_px = get_warp_size_px(config)
    lines: list[tuple[tuple[int, int], tuple[int, int]]] = []
    rects = get_bubble_rects_px(num_questions, num_options, config)
    seen_vertical: set[int] = set()
    seen_horizontal: set[int] = set()
    for (q, o, x1, y1, x2, y2) in rects:
        if x1 not in seen_vertical:
            seen_vertical.add(x1)
            lines.append(((x1, 0), (x1, h_px)))
        if x2 not in seen_vertical:
            seen_vertical.add(x2)
            lines.append(((x2, 0), (x2, h_px)))
        if y1 not in seen_horizontal:
            seen_horizontal.add(y1)
            lines.append(((0, y1), (w_px, y1)))
        if y2 not in seen_horizontal:
            seen_horizontal.add(y2)
            lines.append(((0, y2), (w_px, y2)))
    return lines


# Compatibilidad con código que esperaba centros
def get_bubble_centers_px(
    num_questions: int,
    num_options: int,
    config: Optional[TemplateConfig] = None,
) -> list[tuple[int, int, int, int]]:
    """(question_1based, option_index, cx_px, cy_px) por burbuja."""
    rects = get_bubble_rects_px(num_questions, num_options, config)
    return [
        (q, o, (x1 + x2) // 2, (y1 + y2) // 2)
        for (q, o, x1, y1, x2, y2) in rects
    ]
