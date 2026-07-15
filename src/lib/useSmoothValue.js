import { useEffect, useRef, useState } from 'react'

export function useSmoothValue(target, lerp = 0.15) {
    const currentRef = useRef(0)
    const [value, setValue] = useState(0)

    useEffect(() => {
        let active = true
        let frame = null
        const goal = Number.isFinite(Number(target)) ? Number(target) : 0

        const schedule = () => {
            if (!active || frame !== null || document.visibilityState === 'hidden') return
            frame = requestAnimationFrame(tick)
        }

        function tick() {
            frame = null
            if (!active || document.visibilityState === 'hidden') return
            const delta = goal - currentRef.current
            if (Math.abs(delta) < 0.05) {
                currentRef.current = goal
                setValue(goal)
                return
            }
            currentRef.current += delta * lerp
            setValue(currentRef.current)
            schedule()
        }

        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                if (frame !== null) cancelAnimationFrame(frame)
                frame = null
                return
            }
            schedule()
        }

        document.addEventListener('visibilitychange', onVisibilityChange)
        schedule()
        return () => {
            active = false
            if (frame !== null) cancelAnimationFrame(frame)
            document.removeEventListener('visibilitychange', onVisibilityChange)
        }
    }, [lerp, target])

    return value
}
