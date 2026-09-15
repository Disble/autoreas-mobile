import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * Sky and water gradients shared by the scene layers. Kept in their own component so the
 * `Svg > Defs > LinearGradient > Stop` chain never nests past the JSX depth limit.
 */
function CoverSceneGradients() {
  return (
    <Defs>
      <LinearGradient id="cover-scene-sky" x1="0" x2="0" y1="0" y2="1">
        <Stop offset="0" stopColor="#0b1226" />
        <Stop offset="0.72" stopColor="#132040" />
        <Stop offset="1" stopColor="#0e1830" />
      </LinearGradient>
      <LinearGradient id="cover-scene-water" x1="0" x2="0" y1="0" y2="1">
        <Stop offset="0" stopColor="#0d1a33" />
        <Stop offset="1" stopColor="#070d1c" />
      </LinearGradient>
    </Defs>
  );
}

/** Night sky with the moon, its halo and scattered stars. */
function CoverSceneSky() {
  return (
    <G>
      <Rect fill="url(#cover-scene-sky)" height="94" width="96" y="0" />
      <Rect fill="url(#cover-scene-water)" height="34" width="96" y="94" />
      <Circle cx="71" cy="25" fill="#f6edd9" opacity="0.14" r="14" />
      <Circle cx="71" cy="25" fill="#f6edd9" r="8" />
      <G fill="#e8ecf8">
        <Circle cx="12" cy="14" opacity="0.85" r="1" />
        <Circle cx="30" cy="30" opacity="0.5" r="0.8" />
        <Circle cx="48" cy="12" opacity="0.7" r="0.9" />
        <Circle cx="86" cy="48" opacity="0.45" r="0.8" />
        <Circle cx="22" cy="52" opacity="0.6" r="0.7" />
        <Circle cx="60" cy="42" opacity="0.35" r="0.7" />
      </G>
    </G>
  );
}

/** Suspension bridge silhouette: cable, towers, hangers and deck. */
function CoverSceneBridge() {
  return (
    <G stroke="#05070f" strokeLinecap="round">
      <Path d="M-4 84 Q24 62 48 84 Q72 62 100 84" fill="none" strokeWidth="2" />
      <Line strokeWidth="2.5" x1="20" x2="20" y1="60" y2="94" />
      <Line strokeWidth="2.5" x1="76" x2="76" y1="60" y2="94" />
      <G strokeWidth="0.8">
        <Line x1="8" x2="8" y1="78" y2="90" />
        <Line x1="34" x2="34" y1="76" y2="90" />
        <Line x1="48" x2="48" y1="84" y2="90" />
        <Line x1="62" x2="62" y1="76" y2="90" />
        <Line x1="88" x2="88" y1="78" y2="90" />
      </G>
    </G>
  );
}

/** Bridge deck plus the water ripples and the moon's reflection. */
function CoverSceneWater() {
  return (
    <G>
      <Rect fill="#05070f" height="4" width="96" y="90" />
      <G stroke="#4e7fbf" strokeLinecap="round" strokeWidth="1">
        <Line opacity="0.35" x1="12" x2="24" y1="103" y2="103" />
        <Line opacity="0.25" x1="42" x2="58" y1="110" y2="110" />
        <Line opacity="0.3" x1="70" x2="84" y1="100" y2="100" />
        <Line opacity="0.2" x1="24" x2="36" y1="118" y2="118" />
      </G>
      <G stroke="#f6edd9" strokeLinecap="round" strokeWidth="1">
        <Line opacity="0.3" x1="66" x2="76" y1="98" y2="98" />
        <Line opacity="0.18" x1="68" x2="74" y1="104" y2="104" />
      </G>
    </G>
  );
}

/**
 * Full-bleed night-scene artwork shown where an anime has no cover, ported verbatim from the
 * bridge UI's `CoverPlaceholderScene` so both apps show the same art in the same slot. Its
 * palette is fixed on purpose: it is an illustration, like a cover, not themed chrome.
 * `xMidYMid slice` crops like `contentFit="cover"`, so it fills any card height.
 */
export function CoverPlaceholderScene() {
  return (
    <Svg
      accessibilityLabel="Sin portada"
      accessibilityRole="image"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 96 128"
      width="100%"
    >
      <CoverSceneGradients />
      <CoverSceneSky />
      <CoverSceneBridge />
      <CoverSceneWater />
    </Svg>
  );
}
