from PIL import Image
import os

source_image = r"C:\Users\Administrator\.gemini\antigravity\brain\35e5a370-e31b-44c4-b55d-ac2d73d06cb1\auto_visualizer_icon_base_1772123445626.png"
output_dir = r"c:\@app-dev\auto-visualizer\icons"
sizes = [16, 48, 128]

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

img = Image.open(source_image)

for size in sizes:
    resized_img = img.resize((size, size), Image.Resampling.LANCZOS)
    resized_img.save(os.path.join(output_dir, f"icon{size}.png"))
    print(f"Icon resized to {size}x{size}")
