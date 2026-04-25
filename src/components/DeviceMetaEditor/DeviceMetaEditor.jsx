import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Pencil, Tag, X } from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { logBridgeWarning } from '../../lib/devLog.js'
import { DEVICE_TYPE_OPTIONS } from './deviceTypes'
import './DeviceMetaEditor.css'

/**
 * DeviceMetaEditor — Nickname + type override block for the Scanner detail panel.
 *
 * Edits persist directly to the SQLite inventory via the bridge. Optimistic UI:
 * the value updates immediately and we call the IPC in the background; on
 * error we surface a subtle message without reverting (the user can retry).
 */
export default function DeviceMetaEditor({ device, onChange }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(device?.nickname || '')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const inputRef = useRef(null)

    // Re-sync whenever the SELECTED device changes (new row clicked). We
    // intentionally key on the stable identifier, not nickname, so an
    // edit-in-progress isn't overwritten mid-typing by an optimistic
    // update from onChange → parent → re-render.
    const deviceKey = device?.deviceKey
    const initialNickname = device?.nickname || ''
    useEffect(() => {
        setDraft(initialNickname)
        setEditing(false)
        setError(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deviceKey])

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [editing])

    if (!device?.deviceKey) return null

    async function saveNickname(value) {
        const trimmed = String(value || '').trim()
        const nickname = trimmed.length ? trimmed : null
        setSaving(true)
        setError(null)
        try {
            const updated = await bridge.deviceInventoryUpdate(device.deviceKey, { nickname })
            onChange?.(updated)
            setEditing(false)
        } catch (err) {
            logBridgeWarning('inventory:update-nickname', err)
            setError('Could not save')
        } finally {
            setSaving(false)
        }
    }

    async function saveTypeOverride(value) {
        const typeOverride = value ? String(value) : null
        setSaving(true)
        setError(null)
        try {
            const updated = await bridge.deviceInventoryUpdate(device.deviceKey, { typeOverride })
            onChange?.(updated)
        } catch (err) {
            logBridgeWarning('inventory:update-type', err)
            setError('Could not save')
        } finally {
            setSaving(false)
        }
    }

    const currentType = device.typeOverride || ''

    return (
        <div className="dmeta">
            {/* ── Nickname ─────────────────────────────── */}
            <div className="dmeta-field">
                <label className="dmeta-label">
                    <Pencil size={11} />
                    Nickname
                </label>
                {editing ? (
                    <div className="dmeta-edit-row">
                        <input
                            ref={inputRef}
                            className="dmeta-input"
                            type="text"
                            maxLength={60}
                            value={draft}
                            placeholder="e.g. Office printer"
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveNickname(draft)
                                else if (e.key === 'Escape') { setDraft(device.nickname || ''); setEditing(false) }
                            }}
                            disabled={saving}
                        />
                        <button
                            type="button"
                            className="dmeta-action-btn dmeta-action-btn-save"
                            onClick={() => saveNickname(draft)}
                            disabled={saving}
                            title="Save nickname"
                        >
                            <Check size={14} />
                        </button>
                        <button
                            type="button"
                            className="dmeta-action-btn dmeta-action-btn-cancel"
                            onClick={() => { setDraft(device.nickname || ''); setEditing(false) }}
                            disabled={saving}
                            title="Cancel"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ) : (
                    <div
                        className="dmeta-value-row"
                        onClick={() => setEditing(true)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true) }}
                    >
                        <span className={`dmeta-value-text ${device.nickname ? '' : 'dmeta-value-empty'}`}>
                            {device.nickname || 'Click to add'}
                        </span>
                        {device.nickname && (
                            <button
                                type="button"
                                className="dmeta-mini-btn dmeta-mini-btn-clear"
                                onClick={(e) => { e.stopPropagation(); saveNickname('') }}
                                title="Remove nickname"
                                disabled={saving}
                            >
                                <X size={12} />
                            </button>
                        )}
                        <button
                            type="button"
                            className="dmeta-mini-btn"
                            onClick={(e) => { e.stopPropagation(); setEditing(true) }}
                            title="Edit nickname"
                        >
                            <Pencil size={12} />
                        </button>
                    </div>
                )}
            </div>

            {/* ── Device type ─────────────────────────── */}
            <div className="dmeta-field">
                <label className="dmeta-label">
                    <Tag size={11} />
                    Device type
                </label>
                <div className="dmeta-select-wrap">
                    <select
                        className="dmeta-select"
                        value={currentType}
                        onChange={(e) => saveTypeOverride(e.target.value)}
                        disabled={saving}
                        title={device.typeOverride
                            ? `Set to "${device.typeOverride}" — detected: ${device.rawDeviceType || 'Unknown'}`
                            : `Auto-detected: ${device.rawDeviceType || 'Unknown'}`}
                    >
                        {DEVICE_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                    <ChevronDown size={14} className="dmeta-select-chevron" />
                </div>
                {device.typeOverride && (
                    <span className="dmeta-override-badge" title={`Auto-detected as ${device.rawDeviceType || 'Unknown'}`}>
                        overridden
                    </span>
                )}
            </div>

            {error && <div className="dmeta-error">{error}</div>}
        </div>
    )
}
