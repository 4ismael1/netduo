// @vitest-environment node
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createRotatingLogger } = require('./rotatingLogger')

describe('rotating logger', () => {
    let directory
    let filePath

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netduo-log-'))
        filePath = path.join(directory, 'startup.log')
    })

    afterEach(() => {
        fs.rmSync(directory, { recursive: true, force: true })
    })

    it('batches startup messages into a non-blocking append', async () => {
        const logger = createRotatingLogger({
            resolveFilePath: () => filePath,
            now: () => new Date('2026-07-15T10:00:00.000Z'),
        })
        logger.log('one')
        logger.log('two')
        await logger.flush()

        expect(fs.readFileSync(filePath, 'utf8')).toBe(
            '[2026-07-15T10:00:00.000Z] one\n[2026-07-15T10:00:00.000Z] two\n',
        )
    })

    it('keeps one bounded backup when the active log exceeds its budget', async () => {
        const logger = createRotatingLogger({
            resolveFilePath: () => filePath,
            maxBytes: 50,
            now: () => new Date('2026-07-15T10:00:00.000Z'),
        })
        logger.log('first payload')
        await logger.flush()
        logger.log('second payload')
        await logger.flush()

        expect(fs.existsSync(`${filePath}.1`)).toBe(true)
        expect(fs.readFileSync(`${filePath}.1`, 'utf8')).toContain('first payload')
        expect(fs.readFileSync(filePath, 'utf8')).toContain('second payload')
    })
})
