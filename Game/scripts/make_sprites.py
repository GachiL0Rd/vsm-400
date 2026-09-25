"""Create small original raster test sprites for the isometric client.

Run with Python and Pillow when changing the palette. The committed PNG files are
the game's source art; this script is kept so they can be reproduced exactly.
"""

from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "sprites"
OUT.mkdir(parents=True, exist_ok=True)


def canvas(name, size, draw):
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw(ImageDraw.Draw(image))
    image.save(OUT / f"{name}.png")


def floor(name, top, edge, line):
    def draw(d):
        d.polygon([(48, 6), (95, 24), (48, 47), (1, 24)], fill=edge)
        d.polygon([(48, 1), (95, 22), (48, 44), (1, 22)], fill=top)
        d.line([(1, 22), (48, 44), (95, 22)], fill=line, width=2)
        d.line([(48, 1), (48, 44)], fill=(255, 255, 255, 32), width=1)
    canvas(name, (96, 48), draw)


floor("floor_car", "#d8d2bf", "#8d8877", "#aaa592")
floor("floor_aisle", "#c6bca5", "#817968", "#9e9481")
floor("floor_platform", "#778990", "#42545b", "#667980")
floor("floor_service", "#adc1b4", "#647c72", "#829c90")
floor("floor_door", "#cfad68", "#8d673b", "#ad8549")


def seat(d):
    d.ellipse((5, 56, 67, 74), fill=(25, 35, 43, 70))
    d.polygon([(8, 48), (38, 62), (66, 48), (35, 33)], fill="#354e5b")
    d.polygon([(8, 42), (38, 56), (66, 42), (35, 27)], fill="#6f9a9c")
    d.polygon([(8, 14), (35, 1), (64, 14), (64, 43), (35, 58), (8, 43)], fill="#264551")
    d.polygon([(12, 16), (35, 6), (59, 17), (59, 39), (35, 51), (12, 39)], fill="#517b84")
    d.line([(14, 38), (35, 48), (57, 38)], fill="#86adb0", width=3)
    d.polygon([(8, 46), (35, 60), (64, 46), (64, 53), (35, 68), (8, 53)], fill="#bd715c")
    d.line([(8, 46), (35, 60), (64, 46)], fill="#edaa83", width=2)


canvas("seat", (72, 76), seat)


def wall(d):
    d.polygon([(0, 19), (48, 0), (96, 20), (96, 72), (48, 91), (0, 72)], fill="#17343c")
    d.polygon([(4, 23), (48, 6), (92, 23), (92, 68), (48, 84), (4, 68)], fill="#e7dfc8")
    d.polygon([(12, 30), (48, 17), (84, 30), (84, 58), (48, 71), (12, 58)], fill="#406f7e")
    d.polygon([(16, 32), (48, 21), (80, 32), (80, 54), (48, 65), (16, 54)], fill="#8fc0c3")
    d.line([(48, 21), (48, 65)], fill="#e6f1dc", width=3)
    d.line([(16, 43), (48, 54), (80, 43)], fill="#e6f1dc", width=3)
    d.polygon([(4, 66), (48, 82), (92, 66), (92, 77), (48, 94), (4, 77)], fill="#ae7562")


canvas("window_wall", (96, 96), wall)


def door(d):
    d.polygon([(4, 18), (48, 2), (92, 18), (92, 85), (48, 101), (4, 85)], fill="#23434a")
    d.polygon([(13, 20), (48, 8), (83, 20), (83, 77), (48, 91), (13, 77)], fill="#caa468")
    d.polygon([(22, 31), (48, 22), (74, 31), (74, 75), (48, 84), (22, 75)], fill="#354d54")
    d.line([(48, 22), (48, 84)], fill="#dfcda5", width=3)
    d.ellipse((54, 50, 59, 55), fill="#f1dba5")


canvas("door", (96, 104), door)


def panel(d):
    d.ellipse((3, 58, 51, 72), fill=(18, 32, 34, 75))
    d.polygon([(7, 13), (28, 4), (48, 13), (48, 57), (28, 68), (7, 57)], fill="#1c4049")
    d.polygon([(11, 16), (28, 9), (44, 16), (44, 53), (28, 60), (11, 53)], fill="#5f8c8c")
    d.rounded_rectangle((15, 22, 40, 41), radius=3, fill="#d7e0c4")
    d.line([(19, 35), (25, 32), (31, 36), (38, 26)], fill="#bd715c", width=3)
    d.ellipse((20, 47, 26, 53), fill="#e8b96e")
    d.ellipse((32, 47, 38, 53), fill="#e8b96e")


canvas("panel", (54, 74), panel)


def extinguisher(d):
    d.ellipse((4, 59, 40, 69), fill=(15, 32, 35, 70))
    d.rounded_rectangle((12, 19, 33, 62), radius=7, fill="#b8423d", outline="#6a292d", width=2)
    d.rectangle((17, 13, 28, 20), fill="#353c40")
    d.line([(11, 15), (31, 15), (35, 19)], fill="#263036", width=4)
    d.line([(32, 21), (39, 31), (37, 46)], fill="#293b3e", width=3)
    d.rounded_rectangle((16, 34, 29, 46), radius=2, fill="#f2e2c4")
    d.line([(18, 38), (27, 38)], fill="#b8423d", width=2)


canvas("extinguisher", (44, 70), extinguisher)


def service(d):
    d.ellipse((5, 70, 85, 88), fill=(17, 37, 37, 55))
    d.polygon([(7, 35), (43, 16), (84, 35), (84, 70), (43, 88), (7, 70)], fill="#275960")
    d.polygon([(7, 35), (43, 16), (84, 35), (43, 55)], fill="#95b6a1")
    d.polygon([(13, 44), (43, 58), (78, 43), (78, 65), (43, 79), (13, 65)], fill="#557b78")
    d.line([(20, 52), (43, 64), (71, 52)], fill="#b7d4b1", width=3)
    d.ellipse((35, 25, 51, 34), fill="#e6d4a6")


canvas("service", (90, 90), service)


def toilet(d):
    d.ellipse((5, 65, 65, 79), fill=(17, 37, 37, 55))
    d.polygon([(8, 23), (36, 9), (64, 23), (64, 68), (36, 79), (8, 68)], fill="#2d535a")
    d.polygon([(16, 28), (36, 17), (56, 28), (56, 65), (36, 73), (16, 65)], fill="#e7e1cc")
    d.ellipse((32, 43, 38, 49), fill="#c08754")
    d.polygon([(26, 26), (36, 21), (46, 26), (36, 31)], fill="#6c9e9b")


canvas("toilet", (70, 80), toilet)


def fire(d):
    d.ellipse((3, 67, 61, 77), fill=(65, 45, 31, 85))
    d.polygon([(11, 65), (17, 39), (24, 47), (29, 10), (38, 42), (45, 30), (54, 66)], fill="#cd503b")
    d.polygon([(17, 65), (25, 46), (32, 52), (34, 28), (47, 65)], fill="#ef9c49")
    d.polygon([(24, 65), (33, 46), (40, 65)], fill="#f4df89")


canvas("fire", (64, 78), fire)


def smoke(d):
    d.ellipse((17, 52, 48, 75), fill=(219, 229, 216, 135))
    d.ellipse((9, 31, 40, 59), fill=(198, 216, 208, 105))
    d.ellipse((28, 15, 55, 43), fill=(211, 226, 219, 90))
    d.ellipse((18, 3, 42, 25), fill=(235, 241, 231, 70))


canvas("smoke", (64, 80), smoke)


def person_sheet(name, coat, hair, skin):
    sheet = Image.new("RGBA", (48 * 4, 76), (0, 0, 0, 0))
    for frame in range(4):
        image = Image.new("RGBA", (48, 76), (0, 0, 0, 0))
        d = ImageDraw.Draw(image)
        leg = [-3, 3, -1, 0][frame]
        head = [0, -1, -1, -2][frame]
        d.ellipse((4, 66, 43, 75), fill=(20, 35, 37, 55))
        d.polygon([(17, 49), (24 + leg, 48), (22 + leg, 69), (13, 70)], fill="#233a42")
        d.polygon([(25, 48), (32 - leg, 48), (37 - leg, 70), (26, 70)], fill="#304952")
        d.polygon([(15, 25), (31, 25), (38, 51), (10, 51)], fill=coat)
        d.line([(14, 31), (8, 48)], fill=skin, width=5)
        d.line([(33, 31), (39 if frame != 3 else 44, 46 if frame != 3 else 26)], fill=skin, width=5)
        d.ellipse((15 + head, 5, 33 + head, 29), fill=skin)
        d.pieslice((14 + head, 3, 34 + head, 24), 180, 360, fill=hair)
        d.ellipse((29 + head, 17, 31 + head, 19), fill="#24313a")
        d.polygon([(21, 33), (27, 33), (25, 45)], fill="#e7daba")
        sheet.paste(image, (frame * 48, 0), image)
    sheet.save(OUT / f"{name}.png")


person_sheet("conductor", "#194b65", "#3a2d2d", "#e7bfa2")
person_sheet("passenger_1", "#ba704d", "#453227", "#e6b89a")
person_sheet("passenger_2", "#6d6494", "#5b3930", "#eac6a9")
person_sheet("passenger_3", "#7b8b54", "#272b31", "#d6a583")
person_sheet("passenger_4", "#a56273", "#604437", "#e6bb9b")

print(f"Wrote {len(list(OUT.glob('*.png')))} sprite files to {OUT}")
