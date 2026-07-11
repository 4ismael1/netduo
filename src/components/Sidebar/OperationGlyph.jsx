import { Activity, Radar } from 'lucide-react'

const svgProps = {
    viewBox: '0 0 18 18',
    width: 16,
    height: 16,
    fill: 'none',
    'aria-hidden': true,
}

export default function OperationGlyph({ kind }) {
    if (kind === 'scan') {
        return <Radar size={13} strokeWidth={2} className="op-glyph op-glyph-scan" aria-hidden="true" />
    }

    if (kind === 'check') {
        return (
            <svg {...svgProps} className="op-glyph op-glyph-check">
                <path className="op-muted" d="M9 2.2 14 4.15v4.1c0 3.25-1.9 5.75-5 7.35-3.1-1.6-5-4.1-5-7.35v-4.1L9 2.2Z" />
                <path className="op-primary" d="m6.4 8.8 1.65 1.65 3.55-3.7" />
                <circle className="op-check-ring" cx="9" cy="9" r="7" />
            </svg>
        )
    }

    if (kind === 'wan') {
        return (
            <svg {...svgProps} className="op-glyph op-glyph-wan">
                <circle className="op-primary" cx="9" cy="9" r="5.15" />
                <path className="op-muted" d="M3.9 9h10.2M9 3.85c1.55 1.4 2.3 3.1 2.3 5.15S10.55 12.75 9 14.15C7.45 12.75 6.7 11.05 6.7 9S7.45 5.25 9 3.85Z" />
                <g className="op-wan-orbit"><circle className="op-dot-fill" cx="9" cy="1.25" r="1.25" /></g>
            </svg>
        )
    }

    if (kind === 'speed') {
        return (
            <svg {...svgProps} className="op-glyph op-glyph-speed">
                <path className="op-primary" d="M3.1 12.9a6.45 6.45 0 1 1 11.8 0" />
                <path className="op-muted" d="M4.55 10.2 3.2 9.8m3.1-3.3-.8-1.1M9 5V3.5m2.7 3 .85-1.1m.9 4.8 1.35-.4" />
                <g className="op-speed-needle">
                    <path className="op-primary" d="M9 11.5V5.75" />
                    <circle className="op-dot-fill" cx="9" cy="11.5" r="1.25" />
                </g>
            </svg>
        )
    }

    if (kind === 'monitor') {
        const points = '1.8,9.2 4.2,9.2 5.7,5.1 8.1,13 10.2,7.2 11.7,9.2 16.2,9.2'
        return (
            <svg {...svgProps} className="op-glyph op-glyph-monitor">
                <polyline className="op-monitor-base" points={points} />
                <polyline className="op-monitor-signal" points={points} />
            </svg>
        )
    }

    if (kind === 'route') {
        return (
            <svg {...svgProps} className="op-glyph op-glyph-route">
                <path className="op-route-base" d="M3 13.5C3.4 9.4 6.4 11 7 7.7c.55-3 3.45-1.55 4.2-4.2 1.1 1.65 2.05 3.1 3.8 3.3" />
                <path className="op-route-packet" d="M3 13.5C3.4 9.4 6.4 11 7 7.7c.55-3 3.45-1.55 4.2-4.2 1.1 1.65 2.05 3.1 3.8 3.3" />
                <circle className="op-node" cx="3" cy="13.5" r="1.25" />
                <circle className="op-node" cx="11.2" cy="3.5" r="1.25" />
                <circle className="op-node" cx="15" cy="6.8" r="1.25" />
            </svg>
        )
    }

    if (kind === 'ping') {
        return (
            <svg {...svgProps} className="op-glyph op-glyph-ping">
                <circle className="op-ping-wave op-ping-wave-one" cx="9" cy="9" r="6" />
                <circle className="op-ping-wave op-ping-wave-two" cx="9" cy="9" r="6" />
                <circle className="op-dot-fill" cx="9" cy="9" r="1.7" />
            </svg>
        )
    }

    if (kind === 'ports') {
        return (
            <svg {...svgProps} className="op-glyph op-glyph-ports">
                <rect className="op-port op-port-one" x="2" y="6" width="3.5" height="6" rx="1" />
                <rect className="op-port op-port-two" x="7.25" y="4" width="3.5" height="8" rx="1" />
                <rect className="op-port op-port-three" x="12.5" y="2" width="3.5" height="10" rx="1" />
                <path className="op-muted" d="M2 14.5h14" />
            </svg>
        )
    }

    if (kind === 'benchmark') {
        return (
            <svg {...svgProps} className="op-glyph op-glyph-benchmark">
                <path className="op-muted" d="M2 15h14" />
                <rect className="op-bench op-bench-one" x="2.5" y="9" width="2.75" height="6" rx=".8" />
                <rect className="op-bench op-bench-two" x="7.6" y="5.5" width="2.75" height="9.5" rx=".8" />
                <rect className="op-bench op-bench-three" x="12.7" y="2.5" width="2.75" height="12.5" rx=".8" />
            </svg>
        )
    }

    return <Activity size={13} strokeWidth={2} className="op-glyph" aria-hidden="true" />
}
