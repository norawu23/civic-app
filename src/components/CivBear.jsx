// ─── Helpers ───────────────────────────────────────────────────────────────────

function Star({ cx, cy, s, fill = 'var(--color-gold)' }) {
  const points = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? s : s / 2.2
    const angle = (Math.PI / 5) * i - Math.PI / 2
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`)
  }
  return <polygon points={points.join(' ')} fill={fill} />
}

function Arm({ from, to, curve, animStyle }) {
  const path = `M ${from[0]} ${from[1]} Q ${curve[0]} ${curve[1]} ${to[0]} ${to[1]}`
  return (
    <g style={animStyle}>
      <path d={path} stroke="#1A6BBF" strokeWidth="16" strokeLinecap="round" fill="none" />
      <ellipse cx={to[0]} cy={to[1]} rx="10" ry="8" fill="#0D2440" />
    </g>
  )
}

const ARM_CONFIGS = {
  wave: {
    left:  { from: [72, 132], to: [50, 170], curve: [55, 150] },
    right: { from: [128, 132], to: [166, 56], curve: [160, 100] },
  },
  excited: {
    left:  { from: [72, 130], to: [38, 72], curve: [45, 105] },
    right: { from: [128, 130], to: [162, 72], curve: [155, 105] },
  },
  // Arms swing wide to the sides first, then sweep up to meet the trophy
  // above the head — keeps the limbs clearly outside the body silhouette.
  trophy: {
    left:  { from: [66, 128], to: [80, 54], curve: [22, 148] },
    right: { from: [134, 128], to: [120, 54], curve: [178, 148] },
  },
  encourage: {
    left:  { from: [72, 134], to: [34, 152], curve: [48, 148] },
    right: { from: [128, 134], to: [166, 152], curve: [152, 148] },
  },
}

function Arms({ mood }) {
  const c = ARM_CONFIGS[mood] || ARM_CONFIGS.wave
  const rightAnim =
    mood === 'wave'
      ? {
          transformOrigin: `${c.right.from[0]}px ${c.right.from[1]}px`,
          animation: 'civWaveRotate 1s ease-in-out infinite',
        }
      : undefined
  return (
    <g>
      <Arm {...c.left} />
      <Arm {...c.right} animStyle={rightAnim} />
    </g>
  )
}

function Eyes({ mood }) {
  if (mood === 'excited') {
    return (
      <g stroke="#0D2440" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M 74 68 Q 82 58 90 68" />
        <path d="M 110 68 Q 118 58 126 68" />
      </g>
    )
  }
  return (
    <g>
      <circle cx="82" cy="70" r="9" fill="#ffffff" />
      <circle cx="118" cy="70" r="9" fill="#ffffff" />
      <circle cx="84" cy="71" r="5.5" fill="#0D2440" />
      <circle cx="120" cy="71" r="5.5" fill="#0D2440" />
      <circle cx="86" cy="68" r="2" fill="#ffffff" />
      <circle cx="122" cy="68" r="2" fill="#ffffff" />
    </g>
  )
}

function Mouth({ mood }) {
  if (mood === 'encourage') {
    return <path d="M 90 108 Q 100 104 110 108" stroke="#0D2440" strokeWidth="3" strokeLinecap="round" fill="none" />
  }
  return <path d="M 88 106 Q 100 116 112 106" stroke="#0D2440" strokeWidth="3" strokeLinecap="round" fill="none" />
}

function Trophy() {
  return (
    <g>
      <path d="M 90 40 Q 78 40 78 52 Q 78 62 92 64" stroke="var(--color-gold)" strokeWidth="4" fill="none" />
      <path d="M 110 40 Q 122 40 122 52 Q 122 62 108 64" stroke="var(--color-gold)" strokeWidth="4" fill="none" />
      <path d="M 86 38 L 86 56 Q 86 70 100 70 Q 114 70 114 56 L 114 38 Z" fill="var(--color-gold)" />
      <rect x="96" y="70" width="8" height="10" fill="var(--color-gold)" />
      <rect x="89" y="80" width="22" height="6" rx="2" fill="var(--color-gold)" />
      <Star cx={100} cy={50} s={6} fill="#ffffff" />
    </g>
  )
}

function SpeechBubble({ mood, size }) {
  // Below this size a "wave" bubble can't render its text legibly — skip it
  // entirely rather than show an unreadable sliver.
  if (mood === 'wave' && size < 100) return null

  const isEncourage = mood === 'encourage'
  const bg = isEncourage ? 'var(--color-green)' : 'var(--color-gold)'
  const lines = isEncourage ? ['You got this!', 'Try again'] : ['Hi there!']

  // The SVG content is drawn in a fixed 200×200 user-space and then scaled
  // by the browser to `size` px. A constant font-size in user-units would
  // shrink below readability once the bear renders small. Counter-scale by
  // 1/renderScale so the *rendered* text never drops under ~14px, while
  // still letting it grow proportionally with size once size is large
  // enough that proportional growth alone clears the floor.
  const renderScale = size / 200
  const MIN_RENDERED_FONT_PX = 14
  const NATURAL_FONT_UNITS = 18
  const fontSize = Math.max(NATURAL_FONT_UNITS, MIN_RENDERED_FONT_PX / renderScale)

  const lineHeight = fontSize * 1.3
  const padX = fontSize * 0.9
  const padY = fontSize * 0.55
  const charWidth = fontSize * 0.56

  const longestLine = Math.max(...lines.map(l => l.length))
  const minWidth = fontSize * 5.5
  const width = Math.max(minWidth, longestLine * charWidth + padX * 2)
  const height = lines.length * lineHeight + padY * 2
  const rx = Math.min(20, height * 0.28)

  // Centered above the bear so the tail always points straight down at his
  // head regardless of how wide the bubble had to grow to fit the text.
  const x = (200 - width) / 2
  const y = 6

  const tailSize = Math.max(10, fontSize * 0.7)
  const tailCenterX = x + width / 2

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={rx} fill={bg} />
      <polygon
        points={`${tailCenterX - tailSize * 0.7},${y + height} ${tailCenterX + tailSize * 0.7},${y + height} ${tailCenterX},${y + height + tailSize}`}
        fill={bg}
      />
      {lines.map((line, i) => (
        <text
          key={line}
          x={x + width / 2}
          y={y + padY + fontSize * 0.85 + i * lineHeight}
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight="700"
          fill="#ffffff"
          fontFamily="sans-serif"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

// ─── CivBear ───────────────────────────────────────────────────────────────────

function CivBear({ mood = 'wave', size = 120, style }) {
  const isExcited = mood === 'excited'
  const isTrophy = mood === 'trophy'
  const isEncourage = mood === 'encourage'
  const isWave = mood === 'wave'

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ overflow: 'visible', flexShrink: 0, ...style }}>
      <g style={{ animation: 'civBounce 2s ease-in-out infinite' }}>
        {isExcited && (
          <>
            <Star cx={26} cy={48} s={8} />
            <Star cx={172} cy={54} s={7} />
            <Star cx={18} cy={122} s={6} />
            <Star cx={182} cy={118} s={6} />
          </>
        )}

        <Arms mood={mood} />

        {/* Trophy mood gets a one-time settling wiggle on mount */}
        <g
          style={
            isTrophy
              ? { transformOrigin: '100px 130px', animation: 'civWiggle 1.2s ease-in-out 1' }
              : undefined
          }
        >
          {/* Body */}
          <ellipse cx="100" cy="142" rx="36" ry="28" fill="#1A6BBF" />

          {/* Head group — gets a one-time shake for the encourage mood */}
          <g
            style={
              isEncourage
                ? { transformOrigin: '100px 100px', animation: 'civHeadShake 1.2s ease-in-out 1' }
                : undefined
            }
          >
            <ellipse cx="100" cy="76" rx="42" ry="40" fill="#1A6BBF" />

            <circle cx="68" cy="42" r="16" fill="#1A6BBF" />
            <circle cx="132" cy="42" r="16" fill="#1A6BBF" />
            <circle cx="68" cy="42" r="9" fill="#FF9EBC" />
            <circle cx="132" cy="42" r="9" fill="#FF9EBC" />

            <circle cx="66" cy="92" r="10" fill="#FF9EBC" opacity="0.4" />
            <circle cx="134" cy="92" r="10" fill="#FF9EBC" opacity="0.4" />

            <ellipse cx="100" cy="96" rx="22" ry="16" fill="#5BA3E0" />
            <ellipse cx="100" cy="88" rx="9" ry="6" fill="#0D2440" />

            <Mouth mood={mood} />

            {isEncourage && (
              <g stroke="#0D2440" strokeWidth="3" strokeLinecap="round">
                <line x1="74" y1="56" x2="88" y2="62" />
                <line x1="126" y1="56" x2="112" y2="62" />
              </g>
            )}

            <Eyes mood={mood} />
          </g>

          {isTrophy && <Trophy />}
        </g>

        {(isWave || isEncourage) && <SpeechBubble mood={mood} size={size} />}
      </g>
    </svg>
  )
}

export default CivBear
