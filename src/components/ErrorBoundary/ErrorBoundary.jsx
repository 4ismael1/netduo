import React, { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, info) {
        console.error('ErrorBoundary caught:', error, info)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="error-boundary-fallback">
                    <div className="error-boundary-icon">
                        <AlertTriangle size={32} />
                    </div>
                    <h3 className="error-boundary-title">Component Error</h3>
                    <p className="error-boundary-msg">{this.state.error?.message || 'An unexpected error occurred.'}</p>
                    <button
                        className="btn btn-secondary"
                        onClick={() => this.setState({ hasError: false, error: null })}>
                        <RefreshCw size={14} /> Try Again
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}
