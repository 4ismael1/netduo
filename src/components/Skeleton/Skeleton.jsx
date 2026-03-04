/**
 * Reusable skeleton primitives for loading placeholders.
 * Usage:
 *   <Skeleton w="120px" h="16px" />
 *   <Skeleton w="100%" h="40px" r="12px" />
 *   <SkeletonBlock rows={3} />
 */

import './Skeleton.css'

export function Skeleton({ w = '100%', h = '14px', r = '6px', style, className = '' }) {
    return (
        <span
            className={`sk-bone ${className}`}
            style={{ width: w, height: h, borderRadius: r, ...style }}
        />
    )
}

export function SkeletonCircle({ size = '36px', style, className = '' }) {
    return (
        <span
            className={`sk-bone ${className}`}
            style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, ...style }}
        />
    )
}

export function SkeletonBlock({ rows = 3, gap = '8px', style }) {
    const widths = ['100%', '85%', '60%', '90%', '70%']
    return (
        <div className="sk-block" style={{ gap, ...style }}>
            {Array.from({ length: rows }, (_, i) => (
                <Skeleton key={i} w={widths[i % widths.length]} h="13px" />
            ))}
        </div>
    )
}

export default Skeleton
