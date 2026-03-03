import { useId } from 'react'
import './NetDuoAppIcon.css'

export default function NetDuoAppIcon({ size = 34, mode = 'auto', className = '' }) {
    const safeId = useId().replace(/:/g, '')
    const gradId = `ndGrad${safeId}`
    const glossId = `ndGloss${safeId}`
    const shadowId = `ndShadow${safeId}`

    return (
        <svg
            className={`netduo-mark ${mode} ${className}`.trim()}
            width={size}
            height={size}
            viewBox="0 0 48 48"
            role="img"
            aria-label="NetDuo"
        >
            <defs>
                <linearGradient id={gradId} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" style={{ stopColor: 'var(--nd-bg-start)' }} />
                    <stop offset="100%" style={{ stopColor: 'var(--nd-bg-end)' }} />
                </linearGradient>
                <linearGradient id={glossId} x1="12" y1="9" x2="38" y2="34" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#fff" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
                <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2.5" stdDeviation="2" floodColor="var(--nd-shadow)" />
                </filter>
            </defs>

            <rect x="2" y="2" width="44" height="44" rx="11" fill={`url(#${gradId})`} filter={`url(#${shadowId})`} />
            <rect x="2" y="2" width="44" height="44" rx="11" fill={`url(#${glossId})`} />

            <path
                d="M11 34 L19 20 L25 27 L35 13"
                fill="none"
                stroke="var(--nd-fg)"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="11" cy="34" r="2.8" fill="var(--nd-fg)" />
            <circle cx="35" cy="13" r="2.8" fill="var(--nd-fg)" />
        </svg>
    )
}

