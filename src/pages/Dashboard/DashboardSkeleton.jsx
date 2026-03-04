import { Skeleton, SkeletonCircle } from '../../components/Skeleton/Skeleton.jsx'

/**
 * Full-page skeleton matching the Dashboard layout exactly.
 * Shown while useNetworkStatus is gathering initial data.
 */
export default function DashboardSkeleton() {
    return (
        <div className="dash dash-skeleton">
            {/* Header */}
            <div className="dash-header">
                <div>
                    <Skeleton w="130px" h="22px" r="6px" />
                    <Skeleton w="200px" h="14px" r="5px" style={{ marginTop: 6 }} />
                </div>
                <Skeleton w="112px" h="30px" r="999px" />
            </div>

            {/* Banner */}
            <div className="sk-banner">
                <div className="sk-banner-left">
                    <Skeleton w="38px" h="38px" r="8px" />
                    <div className="sk-banner-text">
                        <Skeleton w="120px" h="16px" r="5px" />
                        <Skeleton w="260px" h="13px" r="5px" />
                    </div>
                </div>
                <div className="sk-banner-right">
                    <Skeleton w="60px" h="28px" r="6px" />
                    <Skeleton w="72px" h="12px" r="4px" />
                </div>
            </div>

            {/* Stat tiles */}
            <div className="dash-stats">
                {[0, 1, 2, 3].map(i => (
                    <div key={i} className="sk-stat-tile">
                        <SkeletonCircle size="36px" />
                        <div className="sk-stat-body">
                            <Skeleton w="60px" h="10px" r="4px" />
                            <Skeleton w="110px" h="15px" r="5px" />
                            <Skeleton w="80px" h="10px" r="4px" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Detail chips */}
            <div className="sk-chips-row">
                {[65, 72, 55, 68, 58, 48].map((w, i) => (
                    <Skeleton key={i} w={`${w}px`} h="26px" r="999px" />
                ))}
            </div>

            {/* Cards row (signal + latency) */}
            <div className="dash-cards-row">
                {/* Signal card */}
                <div className="dash-card">
                    <div className="dash-card-head">
                        <Skeleton w="110px" h="14px" r="5px" />
                        <Skeleton w="60px" h="22px" r="999px" />
                    </div>
                    <Skeleton w="100%" h="140px" r="8px" />
                    <div className="sk-legend-row">
                        {[0, 1, 2, 3].map(i => (
                            <Skeleton key={i} w="48px" h="10px" r="3px" />
                        ))}
                    </div>
                </div>

                {/* Latency card */}
                <div className="dash-card">
                    <div className="dash-card-head">
                        <Skeleton w="100px" h="14px" r="5px" />
                        <Skeleton w="120px" h="12px" r="4px" />
                    </div>
                    <div className="chart-grid">
                        {[0, 1, 2].map(i => (
                            <div key={i} className="sk-chart-cell">
                                <div className="sk-chart-label">
                                    <Skeleton w="8px" h="8px" r="50%" />
                                    <Skeleton w="70px" h="12px" r="4px" />
                                    <Skeleton w="40px" h="12px" r="4px" style={{ marginLeft: 'auto' }} />
                                </div>
                                <Skeleton w="100%" h="128px" r="6px" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Quick tools */}
            <div className="dash-card">
                <div className="dash-card-head">
                    <Skeleton w="96px" h="14px" r="5px" />
                </div>
                <div className="action-grid">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className="sk-action-card">
                            <Skeleton w="36px" h="36px" r="8px" />
                            <div className="sk-action-body">
                                <Skeleton w="80px" h="13px" r="4px" />
                                <Skeleton w="100px" h="10px" r="4px" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
