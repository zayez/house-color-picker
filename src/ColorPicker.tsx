import { useState, useCallback, useRef, useEffect } from "react";
import "./ColorPicker.css";

type ColorMode = "hsl" | "oklch";

interface ColorPickerProps {
  color: string; // hex
  onChange: (hex: string) => void;
}

// --- Color conversion utilities ---

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }

  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// --- OKLCH conversions ---
// sRGB -> linear sRGB
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  // sRGB to linear
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);

  // Linear sRGB to OKLab
  const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l = Math.cbrt(l_);
  const m = Math.cbrt(m_);
  const s = Math.cbrt(s_);

  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bOk = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

  const C = Math.sqrt(a * a + bOk * bOk);
  let H = (Math.atan2(bOk, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return [
    Math.round(L * 100 * 100) / 100,   // L: 0-100
    Math.round(C * 100 * 1000) / 1000,  // C: 0-~37
    Math.round(H * 100) / 100,          // H: 0-360
  ];
}

function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  L = L / 100;
  C = C / 100;
  const hRad = (H * Math.PI) / 180;

  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;

  const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  return [
    clamp(Math.round(linearToSrgb(lr) * 255), 0, 255),
    clamp(Math.round(linearToSrgb(lg) * 255), 0, 255),
    clamp(Math.round(linearToSrgb(lb) * 255), 0, 255),
  ];
}

// --- Hue gradient bar component ---
function HueBar({ hue, onChange }: { hue: number; onChange: (h: number) => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      onChange(Math.round(ratio * 360));
    },
    [onChange]
  );

  const onDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      dragging.current = true;
      const x = "touches" in e ? e.touches[0].clientX : e.clientX;
      update(x);
    },
    [update]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const x = "touches" in e ? e.touches[0].clientX : e.clientX;
      update(x);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [update]);

  return (
    <div
      ref={barRef}
      className="hue-bar"
      onMouseDown={onDown}
      onTouchStart={onDown}
    >
      <div
        className="hue-thumb"
        style={{ left: `${(hue / 360) * 100}%` }}
      />
    </div>
  );
}

// --- Main component ---
export default function ColorPicker({ color, onChange }: ColorPickerProps) {
  const [mode, setMode] = useState<ColorMode>("hsl");
  const [hexInput, setHexInput] = useState(color);

  // Store HSL and OKLCH as internal state to avoid round-trip loss
  const [hsl, setHsl] = useState<[number, number, number]>(() =>
    rgbToHsl(...hexToRgb(color))
  );
  const [oklch, setOklch] = useState<[number, number, number]>(() =>
    rgbToOklch(...hexToRgb(color))
  );

  // Track whether we're driving the change (slider) vs receiving external update
  const internalUpdate = useRef(false);

  // Sync from external color prop changes (e.g. hex input, or parent reset)
  useEffect(() => {
    setHexInput(color);
    if (!internalUpdate.current) {
      const rgb = hexToRgb(color);
      setHsl(rgbToHsl(...rgb));
      setOklch(rgbToOklch(...rgb));
    }
    internalUpdate.current = false;
  }, [color]);

  const emitHsl = useCallback(
    (hue: number, sat: number, lig: number) => {
      setHsl([hue, sat, lig]);
      // Also update oklch to stay in sync
      const [r, g, b] = hslToRgb(hue, sat, lig);
      setOklch(rgbToOklch(r, g, b));
      internalUpdate.current = true;
      onChange(rgbToHex(r, g, b));
    },
    [onChange]
  );

  const emitOklch = useCallback(
    (L: number, C: number, H: number) => {
      setOklch([L, C, H]);
      // Also update hsl to stay in sync
      const [r, g, b] = oklchToRgb(L, C, H);
      setHsl(rgbToHsl(r, g, b));
      internalUpdate.current = true;
      onChange(rgbToHex(r, g, b));
    },
    [onChange]
  );

  const handleHexSubmit = useCallback(() => {
    const cleaned = hexInput.trim();
    let hex: string | null = null;
    if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) {
      hex = cleaned.toLowerCase();
    } else if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      hex = `#${cleaned.toLowerCase()}`;
    }
    if (hex) {
      const rgb = hexToRgb(hex);
      setHsl(rgbToHsl(...rgb));
      setOklch(rgbToOklch(...rgb));
      onChange(hex);
    }
  }, [hexInput, onChange]);

  const [h, s, l] = hsl;
  const [oL, oC, oH] = oklch;

  return (
    <div className="color-picker">
      <div className="cp-preview-row">
        <div
          className="cp-swatch"
          style={{ backgroundColor: color }}
        />
        <input
          className="cp-hex-input"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={handleHexSubmit}
          onKeyDown={(e) => e.key === "Enter" && handleHexSubmit()}
          spellCheck={false}
        />
        <div className="cp-mode-tabs">
          <button
            className={mode === "hsl" ? "active" : ""}
            onClick={() => setMode("hsl")}
          >
            HSL
          </button>
          <button
            className={mode === "oklch" ? "active" : ""}
            onClick={() => setMode("oklch")}
          >
            OKLCH
          </button>
        </div>
      </div>

      <HueBar
        hue={mode === "hsl" ? h : oH}
        onChange={(v) =>
          mode === "hsl" ? emitHsl(v, s, l) : emitOklch(oL, oC, v)
        }
      />

      {mode === "hsl" && (
        <div className="cp-sliders">
          <SliderRow label="H" value={h} min={0} max={360} unit="°"
            onChange={(v) => emitHsl(v, s, l)} />
          <SliderRow label="S" value={s} min={0} max={100} unit="%"
            onChange={(v) => emitHsl(h, v, l)} />
          <SliderRow label="L" value={l} min={0} max={100} unit="%"
            onChange={(v) => emitHsl(h, s, v)} />
        </div>
      )}

      {mode === "oklch" && (
        <div className="cp-sliders">
          <SliderRow label="L" value={oL} min={0} max={100} step={0.1} unit="%"
            onChange={(v) => emitOklch(v, oC, oH)} />
          <SliderRow label="C" value={oC} min={0} max={37} step={0.1} unit=""
            onChange={(v) => emitOklch(oL, v, oH)} />
          <SliderRow label="H" value={oH} min={0} max={360} step={0.1} unit="°"
            onChange={(v) => emitOklch(oL, oC, v)} />
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label, value, min, max, step = 1, unit, onChange,
}: {
  label: string; value: number; min: number; max: number;
  step?: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="cp-slider-row">
      <span className="cp-slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="cp-slider-value">
        {step < 1 ? value.toFixed(1) : value}{unit}
      </span>
    </div>
  );
}
