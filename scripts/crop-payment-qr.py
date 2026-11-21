"""Crop a user-supplied QR original, preserving its payload and quiet zone.

Usage: python crop-payment-qr.py /absolute/original.jpg /absolute/cropped.png
Dependencies: Pillow, zxing-cpp. Never synthesizes or replaces the QR payload.
"""
import argparse
from pathlib import Path
from PIL import Image, ImageOps
import zxingcpp


def crop(source: Path, target: Path):
    original = ImageOps.exif_transpose(Image.open(source)).convert("RGB")
    results = zxingcpp.read_barcodes(original)
    if len(results) != 1:
        raise ValueError("Expected exactly one readable QR code; refusing to guess")
    result = results[0]
    if result.format != zxingcpp.BarcodeFormat.QRCode:
        raise ValueError("The supplied image is not a QR code")
    points = [result.position.top_left, result.position.top_right,
              result.position.bottom_left, result.position.bottom_right]
    box = (min(p.x for p in points), min(p.y for p in points),
           max(p.x for p in points) + 1, max(p.y for p in points) + 1)
    body = original.crop(box)
    # Four modules even for the smallest 21-module QR; deliberately conservative.
    margin = max(8, round(max(body.size) * 4 / 21))
    output = ImageOps.expand(body, border=margin, fill="white")
    check = zxingcpp.read_barcodes(output)
    if len(check) != 1 or check[0].bytes != result.bytes:
        raise ValueError("Cropped QR does not decode to the original payload")
    if target.exists():
        raise FileExistsError("Choose a new output filename")
    target.parent.mkdir(parents=True, exist_ok=True)
    output.save(target, format="PNG")
    print(f"Saved verified QR crop: {target} ({output.width}×{output.height})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    crop(args.source, args.target)
