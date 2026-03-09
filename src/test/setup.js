import '@testing-library/jest-dom'

// Mock window.electronAPI globally (not available in jsdom)
if (typeof global.window !== 'undefined') {
    global.window.electronAPI = undefined
}

// Silence React console.error for cleaner test output (still throws)
const originalError = console.error
beforeAll(() => {
    console.error = (...args) => {
        if (
            typeof args[0] === 'string' &&
            (args[0].includes('ReactDOM.render') || args[0].includes('act('))
        ) return
        originalError(...args)
    }
})
afterAll(() => { console.error = originalError })
