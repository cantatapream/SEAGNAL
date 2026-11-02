import sys, glob
from PIL import Image, ImageDraw
fs = sorted(glob.glob(sys.argv[1] + '/still_*.png'), key=lambda f: float(f.split('_')[-1][:-4]))
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4; w, h = 480, 270
rows = (len(fs) + cols - 1) // cols
S = Image.new('RGB', (cols * (w + 6), rows * (h + 6)), (60, 60, 60))
for i, f in enumerate(fs):
    im = Image.open(f).convert('RGB').resize((w, h), Image.LANCZOS)
    d = ImageDraw.Draw(im); d.rectangle((0, 0, 70, 22), fill=(0, 0, 0)); d.text((4, 4), f.split('_')[-1][:-4], fill=(255, 255, 0))
    S.paste(im, ((i % cols) * (w + 6), (i // cols) * (h + 6)))
S.save(sys.argv[2], quality=82)
