/**
 * Validates LAN scanner ping-output parsing.
 *
 * Windows localized failures can include "Respuesta desde" even when the
 * probe failed. Scanner discovery must not treat those lines as live devices.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const localRequire = createRequire(import.meta.url)
const { isPingReply } = localRequire('../electron/scanner/pingOutput.js')

describe('scanner ping output parsing', () => {
    it('accepts Windows Spanish successful replies', () => {
        expect(isPingReply('Respuesta desde 192.168.100.227: bytes=32 tiempo=68ms TTL=64')).toBe(true)
        expect(isPingReply('Respuesta desde 192.168.100.1: bytes=32 tiempo<1m TTL=64')).toBe(true)
    })

    it('accepts Windows English and Unix successful replies', () => {
        expect(isPingReply('Reply from 192.168.100.1: bytes=32 time=1ms TTL=64')).toBe(true)
        expect(isPingReply('64 bytes from 192.168.100.1: icmp_seq=1 ttl=64 time=0.8 ms')).toBe(true)
    })

    it('rejects Windows Spanish unreachable replies that still start with Respuesta desde', () => {
        expect(isPingReply('Respuesta desde 192.168.100.186: Host de destino inaccesible.')).toBe(false)
    })

    it('rejects common timeout and unreachable failures', () => {
        expect(isPingReply('Tiempo de espera agotado para esta solicitud.')).toBe(false)
        expect(isPingReply('Request timed out.')).toBe(false)
        expect(isPingReply('Reply from 192.168.100.186: Destination host unreachable.')).toBe(false)
    })
})
