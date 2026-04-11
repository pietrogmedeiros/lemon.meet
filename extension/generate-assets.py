"""
Gera todos os assets de imagem obrigatórios para a Chrome Web Store.
Roda sem dependências externas — usa apenas stdlib do Python.
"""

import struct
import zlib
import os

# ── Helper: gera PNG válido 24-bit sem alpha ──────────────────

def make_png(width: int, height: int, pixels: list[tuple[int,int,int]]) -> bytes:
    """Gera bytes de um PNG RGB 24-bit sem canal alpha."""
    def chunk(name: bytes, data: bytes) -> bytes:
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    # IHDR
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)

    # IDAT — linha por linha com filtro 0
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter type None
        for x in range(width):
            r, g, b = pixels[y * width + x]
            raw += bytes([r, g, b])
    compressed = zlib.compress(raw, 9)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', compressed)
        + chunk(b'IEND', b'')
    )

# ── Design Lemon.meet ─────────────────────────────────────────

GREEN      = (45, 90, 39)    # #2D5A27
GREEN_L    = (76, 175, 80)   # #4CAF50
YELLOW     = (255, 215, 0)   # #FFD700
WHITE      = (255, 255, 255)
GRAY_BG    = (248, 249, 250) # #F8F9FA
GRAY_CARD  = (255, 255, 255)
TEXT_DARK  = (51, 51, 51)
TEXT_MID   = (102, 102, 102)

def draw_rect(pixels, W, H, x0, y0, x1, y1, color):
    for y in range(max(0,y0), min(H,y1)):
        for x in range(max(0,x0), min(W,x1)):
            pixels[y * W + x] = color

def draw_circle(pixels, W, H, cx, cy, r, color):
    for y in range(max(0, cy-r), min(H, cy+r+1)):
        for x in range(max(0, cx-r), min(W, cx+r+1)):
            if (x-cx)**2 + (y-cy)**2 <= r**2:
                pixels[y * W + x] = color

def draw_rounded_rect(pixels, W, H, x0, y0, x1, y1, r, color):
    draw_rect(pixels, W, H, x0+r, y0, x1-r, y1, color)
    draw_rect(pixels, W, H, x0, y0+r, x1, y1-r, color)
    draw_circle(pixels, W, H, x0+r, y0+r, r, color)
    draw_circle(pixels, W, H, x1-r, y0+r, r, color)
    draw_circle(pixels, W, H, x0+r, y1-r, r, color)
    draw_circle(pixels, W, H, x1-r, y1-r, r, color)

# ── Ícone 128x128 ─────────────────────────────────────────────

def make_icon(size: int) -> bytes:
    W = H = size
    px = [GRAY_BG] * (W * H)
    pad = size // 8

    # Fundo verde arredondado
    draw_rounded_rect(px, W, H, pad, pad, W-pad, H-pad, size//6, GREEN)

    # Círculo amarelo central (microfone estilizado)
    cx, cy = W//2, H//2
    draw_circle(px, W, H, cx, cy, size//5, YELLOW)
    draw_circle(px, W, H, cx, cy, size//9, GREEN)

    # Ponto interno branco
    draw_circle(px, W, H, cx, cy, size//16, WHITE)

    return make_png(W, H, px)

# ── Screenshot 1280x800 ───────────────────────────────────────

def make_screenshot() -> bytes:
    W, H = 1280, 800
    px = [GRAY_BG] * (W * H)

    # Barra de topo
    draw_rect(px, W, H, 0, 0, W, 64, GREEN)

    # Logo area no topo
    draw_circle(px, W, H, 48, 32, 18, YELLOW)
    draw_circle(px, W, H, 48, 32, 8, GREEN)

    # Título (simulado com blocos brancos)
    draw_rect(px, W, H, 76, 24, 220, 42, WHITE)

    # Card principal
    draw_rounded_rect(px, W, H, 80, 100, 560, 360, 12, WHITE)

    # Badge "Gravando"
    draw_rounded_rect(px, W, H, 100, 120, 230, 148, 8, (220, 53, 69))
    draw_rect(px, W, H, 108, 130, 128, 140, WHITE)
    draw_rect(px, W, H, 136, 130, 220, 140, WHITE)

    # Título da reunião
    draw_rect(px, W, H, 100, 162, 400, 180, TEXT_DARK)
    draw_rect(px, W, H, 100, 188, 280, 200, TEXT_MID)

    # Linha divisória
    draw_rect(px, W, H, 100, 220, 540, 222, (224, 224, 224))

    # Segmentos de transcrição (linhas simuladas)
    y = 240
    widths = [380, 320, 420, 290, 360, 400, 310]
    for i, w in enumerate(widths):
        color = GREEN_L if i % 3 == 0 else TEXT_MID
        draw_rect(px, W, H, 100, y, 100+w, y+10, color)
        y += 26

    # Card de insights (direita)
    draw_rounded_rect(px, W, H, 600, 100, 1200, 700, 12, WHITE)

    # Cabeçalho do card
    draw_rect(px, W, H, 620, 120, 900, 138, TEXT_DARK)
    draw_rect(px, W, H, 620, 146, 780, 158, TEXT_MID)

    # Barra de probabilidade
    draw_rect(px, W, H, 620, 200, 1180, 220, (224, 224, 224))
    draw_rect(px, W, H, 620, 200, 960, 220, GREEN_L)   # 73%
    draw_rect(px, W, H, 620, 228, 740, 240, TEXT_MID)

    # Sentiment badge
    draw_rounded_rect(px, W, H, 620, 260, 760, 290, 8, (76, 175, 80))
    draw_rect(px, W, H, 636, 270, 744, 282, WHITE)

    # Action items
    y2 = 320
    for _ in range(4):
        draw_circle(px, W, H, 636, y2+6, 5, GREEN)
        draw_rect(px, W, H, 650, y2, 650+280, y2+12, TEXT_DARK)
        y2 += 32

    # Rodapé
    draw_rect(px, W, H, 0, H-48, W, H, GREEN)
    draw_rect(px, W, H, W//2-120, H-32, W//2+120, H-20, WHITE)

    return make_png(W, H, px)

# ── Small promo tile 440x280 ──────────────────────────────────

def make_promo_small() -> bytes:
    W, H = 440, 280
    px = [GREEN] * (W * H)

    # Gradiente simulado (faixa mais clara no topo)
    for y in range(80):
        ratio = y / 80
        c = tuple(int(GREEN[i] + (GREEN_L[i] - GREEN[i]) * ratio) for i in range(3))
        draw_rect(px, W, H, 0, y, W, y+1, c)

    # Logo centro
    cx, cy = W//2, H//2 - 20
    draw_circle(px, W, H, cx, cy, 48, YELLOW)
    draw_circle(px, W, H, cx, cy, 22, GREEN)
    draw_circle(px, W, H, cx, cy, 10, YELLOW)

    # Nome (simulado)
    draw_rect(px, W, H, cx-80, cy+64, cx+80, cy+80, WHITE)
    draw_rect(px, W, H, cx-52, cy+88, cx+52, cy+98, (200, 230, 200))

    return make_png(W, H, px)

# ── Large promo tile 1400x560 ─────────────────────────────────

def make_promo_large() -> bytes:
    W, H = 1400, 560
    px = [GREEN] * (W * H)

    # Fundo com faixa
    draw_rect(px, W, H, 0, 0, W, H//3, GREEN_L)

    # Logo esquerda
    cx, cy = 200, H//2
    draw_circle(px, W, H, cx, cy, 80, YELLOW)
    draw_circle(px, W, H, cx, cy, 36, GREEN)
    draw_circle(px, W, H, cx, cy, 16, YELLOW)

    # Texto simulado
    draw_rect(px, W, H, 320, cy-48, 820, cy-24, WHITE)
    draw_rect(px, W, H, 320, cy-16, 640, cy+4, (200, 230, 200))
    draw_rect(px, W, H, 320, cy+16, 720, cy+30, (200, 230, 200))

    # Mock do popup à direita
    draw_rounded_rect(px, W, H, 980, 80, 1320, 480, 16, WHITE)
    draw_rect(px, W, H, 980, 80, 1320, 130, GREEN)
    draw_circle(px, W, H, 1006, 105, 14, YELLOW)
    draw_rect(px, W, H, 1028, 98, 1200, 114, WHITE)

    # Botão simular
    draw_rounded_rect(px, W, H, 1010, 280, 1290, 320, 8, GREEN_L)
    draw_rect(px, W, H, 1060, 294, 1240, 308, WHITE)

    return make_png(W, H, px)

# ── Gerar todos os arquivos ───────────────────────────────────

out = os.path.join(os.path.dirname(__file__), 'store-assets')
os.makedirs(out, exist_ok=True)

assets = {
    'icon128.png':       make_icon(128),
    'icon48.png':        make_icon(48),
    'icon16.png':        make_icon(16),
    'screenshot.png':    make_screenshot(),
    'promo-small.png':   make_promo_small(),
    'promo-large.png':   make_promo_large(),
}

for name, data in assets.items():
    path = os.path.join(out, name)
    with open(path, 'wb') as f:
        f.write(data)
    size_kb = len(data) / 1024
    print(f'✓ {name:25s} → {size_kb:.1f} KB')

print(f'\nAssets em: {out}')
