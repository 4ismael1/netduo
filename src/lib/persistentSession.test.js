import { beforeEach, describe, expect, it } from 'vitest'
import {
    getSessionRef,
    getSessionSnapshot,
    resetPersistentSessionsForTests,
    setSessionValue,
} from './persistentSession.js'

describe('persistent operation sessions', () => {
    beforeEach(() => resetPersistentSessionsForTests())

    it('keeps values independently of a page component lifecycle', () => {
        setSessionValue('speed-test', 'phase', 'downloading')
        setSessionValue('speed-test', 'progress', 42)
        setSessionValue('speed-test', 'progress', value => value + 1)

        expect(getSessionSnapshot('speed-test')).toEqual({
            phase: 'downloading',
            progress: 43,
        })
        expect(getSessionSnapshot('monitor')).toEqual({})
    })

    it('returns stable controller refs for background work', () => {
        const first = getSessionRef('monitor', 'timer', null)
        first.current = 123
        const second = getSessionRef('monitor', 'timer', null)

        expect(second).toBe(first)
        expect(second.current).toBe(123)
    })
})
