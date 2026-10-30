import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'

const API_URL = 'http://127.0.0.1:8000/api/historical'
const FORECAST_API_URL = 'http://127.0.0.1:8000/api/forecast'
const numberFormat = new Intl.NumberFormat('en-GB')
const metricFormat = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

function formatTime(value) {
  if (!value) return ''

  return new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function GenerationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null

  const record = payload[0].payload

  return (
    <div className="chart-tooltip">
      <span className="tooltip-period">
        Period {record.settlementPeriod}
        {record.forecastStartTime || record.startTime
          ? ` · ${formatTime(record.forecastStartTime || record.startTime)}`
          : ''}
      </span>
      {Number.isFinite(record.historicalGeneration) && (
        <span className="tooltip-series historical-tooltip">
          Historical <strong>{numberFormat.format(record.historicalGeneration)} MW</strong>
        </span>
      )}
      {Number.isFinite(record.forecastGeneration) && (
        <span className="tooltip-series forecast-tooltip">
          Forecast <strong>{numberFormat.format(record.forecastGeneration)} MW</strong>
        </span>
      )}
    </div>
  )
}

function App() {
  const [historicalRecords, setHistoricalRecords] = useState([])
  const [forecastRecords, setForecastRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [requestId, setRequestId] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadData() {
      try {
        const [historicalResponse, forecastResponse] = await Promise.all([
          axios.get(API_URL, { signal: controller.signal }),
          axios.get(FORECAST_API_URL, { signal: controller.signal }),
        ])
        if (
          !Array.isArray(historicalResponse.data) ||
          !Array.isArray(forecastResponse.data)
        ) {
          throw new Error('The API response did not contain lists of records.')
        }

        const actual = historicalResponse.data
          .filter(
            (record) =>
              record.fuelType === 'WIND' &&
              Number.isFinite(Number(record.settlementPeriod)) &&
              Number.isFinite(Number(record.generation)),
          )
          .map((record) => ({
            ...record,
            settlementPeriod: Number(record.settlementPeriod),
            generation: Number(record.generation),
          }))
          .sort((a, b) => a.settlementPeriod - b.settlementPeriod)
        const forecasts = forecastResponse.data
          .filter(
            (record) =>
              Number.isFinite(Number(record.settlementPeriod)) &&
              Number.isFinite(Number(record.generation)),
          )
          .map((record) => ({
            ...record,
            settlementPeriod: Number(record.settlementPeriod),
            generation: Number(record.generation),
          }))
          .sort((a, b) => a.settlementPeriod - b.settlementPeriod)

        if (!controller.signal.aborted) {
          setHistoricalRecords(actual)
          setForecastRecords(forecasts)
          setError('')
          setLoading(false)
        }
      } catch (requestError) {
        if (controller.signal.aborted) return

        setError(
          axios.isAxiosError(requestError)
            ? requestError.response?.data?.detail ||
                requestError.message ||
                'Could not load generation data.'
            : requestError.message,
        )
        setLoading(false)
      }
    }

    loadData()

    return () => controller.abort()
  }, [requestId])

  const chartData = useMemo(() => {
    const points = new Map()
    const getPoint = (period) => {
      if (!points.has(period)) points.set(period, { settlementPeriod: period })
      return points.get(period)
    }

    historicalRecords.forEach((record) => {
      Object.assign(getPoint(record.settlementPeriod), {
        historicalGeneration: record.generation,
        startTime: record.startTime,
      })
    })
    forecastRecords.forEach((record) => {
      Object.assign(getPoint(record.settlementPeriod), {
        forecastGeneration: record.generation,
        forecastStartTime: record.startTime,
      })
    })

    return [...points.values()].sort(
      (a, b) => a.settlementPeriod - b.settlementPeriod,
    )
  }, [historicalRecords, forecastRecords])

  const summary = useMemo(() => {
    const actualAverage = historicalRecords.length
      ? historicalRecords.reduce((sum, record) => sum + record.generation, 0) /
        historicalRecords.length
      : null
    const forecastAverage = forecastRecords.length
      ? forecastRecords.reduce((sum, record) => sum + record.generation, 0) /
        forecastRecords.length
      : null
    const actualByHour = new Map()

    historicalRecords.forEach((record) => {
      const hour = new Date(record.startTime)
      hour.setUTCMinutes(0, 0, 0)
      const key = hour.toISOString()
      const bucket = actualByHour.get(key) || { count: 0, total: 0 }
      bucket.count += 1
      bucket.total += record.generation
      actualByHour.set(key, bucket)
    })

    const errors = forecastRecords.flatMap((record) => {
      const hour = new Date(record.startTime)
      hour.setUTCMinutes(0, 0, 0)
      const bucket = actualByHour.get(hour.toISOString())
      if (!bucket || bucket.count !== 2) return []

      const actual = bucket.total / bucket.count
      return [{ actual, error: record.generation - actual }]
    })
    const meanAbsoluteError = errors.length
      ? errors.reduce((sum, item) => sum + Math.abs(item.error), 0) /
        errors.length
      : null
    const rootMeanSquareError = errors.length
      ? Math.sqrt(
          errors.reduce((sum, item) => sum + item.error ** 2, 0) / errors.length,
        )
      : null
    const forecastBias = errors.length
      ? errors.reduce((sum, item) => sum + item.error, 0) / errors.length
      : null

    return {
      actualAverage,
      forecastAverage,
      forecastBias,
      matchedHours: errors.length,
      meanAbsoluteError,
      rootMeanSquareError,
    }
  }, [historicalRecords, forecastRecords])

  const settlementDate = historicalRecords[0]?.settlementDate
  const dateLabel = settlementDate
    ? new Date(`${settlementDate}T12:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'Historical data'

  return (
    <main className="dashboard">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Gridline home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M4 23.5 11 16l5 4 11-12" />
              <path d="M20 8h7v7" />
            </svg>
          </span>
          <span>gridline<span className="brand-period">.</span></span>
        </a>
        <div className="live-status">
          <span className="status-dot" />
          <span>Generation overview</span>
        </div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">UK POWER SYSTEM</p>
          <h1>Wind generation</h1>
          <p className="page-subtitle">
            Half-hourly actual output against the hourly wind forecast.
          </p>
        </div>
        <div className="date-chip">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="3" y="5" width="14" height="12" rx="2" />
            <path d="M6.5 3v4M13.5 3v4M3 9h14" />
          </svg>
          {dateLabel}
        </div>
      </section>

      {error ? (
        <section className="state-card error-card" role="alert">
          <div className="state-icon error-icon">!</div>
          <div>
            <h2>Couldn’t load generation data</h2>
            <p>{error}</p>
            <button
              className="retry-button"
              onClick={() => {
                setLoading(true)
                setError('')
                setRequestId((current) => current + 1)
              }}
              type="button"
            >
              Try again
            </button>
          </div>
        </section>
      ) : loading ? (
        <section className="state-card" aria-live="polite">
          <div className="spinner" />
          <p>Loading generation data…</p>
        </section>
      ) : !historicalRecords.length && !forecastRecords.length ? (
        <section className="state-card">
          <div className="state-icon">—</div>
          <h2>No wind data available</h2>
          <p>Historical and forecast records are both empty.</p>
        </section>
      ) : (
        <>
          <section className="metric-grid" aria-label="Forecast accuracy summary">
            <article className="metric-card primary-metric">
              <div className="metric-topline">
                <span>Actual average</span>
                <span className="metric-icon wind-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 12 6.5 6.5M12 12l7.5-2M12 12l-2 8" />
                    <circle cx="12" cy="12" r="1.6" />
                  </svg>
                </span>
              </div>
              <p className="metric-value">
                {summary.actualAverage === null
                  ? '—'
                  : numberFormat.format(Math.round(summary.actualAverage))}
                <span>MW</span>
              </p>
              <p className="metric-caption">
                Across {historicalRecords.length} half-hourly readings
              </p>
            </article>
            <article className="metric-card">
              <div className="metric-topline">
                <span>Forecast average</span>
                <span className="metric-icon peak-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M4 17 10 11l4 4 6-8" />
                    <path d="M15 7h5v5" />
                  </svg>
                </span>
              </div>
              <p className="metric-value">
                {summary.forecastAverage === null
                  ? '—'
                  : numberFormat.format(Math.round(summary.forecastAverage))}
                <span>MW</span>
              </p>
              <p className="metric-caption">
                Across {forecastRecords.length} hourly forecasts
              </p>
            </article>
            <article className="metric-card">
              <div className="metric-topline">
                <span>Mean absolute error</span>
                <span className="metric-icon total-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 19V9m7 10V5m7 14v-7" />
                  </svg>
                </span>
              </div>
              <p className="metric-value">
                {summary.meanAbsoluteError === null
                  ? '—'
                  : metricFormat.format(summary.meanAbsoluteError)}
                <span>MW</span>
              </p>
              <p className="metric-caption">
                {summary.matchedHours
                  ? `Based on ${summary.matchedHours} matched hours`
                  : 'Waiting for matched actual hours'}
              </p>
            </article>
            <article className="metric-card">
              <div className="metric-topline">
                <span>Forecast bias</span>
                <span className="metric-icon total-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </span>
              </div>
              <p className="metric-value">
                {summary.forecastBias === null
                  ? '—'
                  : `${summary.forecastBias > 0 ? '+' : ''}${metricFormat.format(
                      summary.forecastBias,
                    )}`}
                <span>MW</span>
              </p>
              <p className="metric-caption">Forecast minus actual; positive means overforecast</p>
            </article>
          </section>

          <section className="chart-card">
            <div className="chart-heading">
              <div>
                <p className="eyebrow">ACTUAL VS FORECAST</p>
                <h2>Wind generation profile</h2>
              </div>
              <div className="chart-legend">
                <span className="legend-item">
                  <span className="legend-line historical-line" />
                  Historical
                </span>
                <span className="legend-item">
                  <span className="legend-line forecast-line" />
                  Forecast
                </span>
                <span className="legend-unit">MW</span>
              </div>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 16, right: 12, left: 4, bottom: 4 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="#edf0ee"
                    strokeDasharray="3 5"
                  />
                  <XAxis
                    dataKey="settlementPeriod"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#8b9691', fontSize: 12 }}
                    tickCount={9}
                    tickMargin={12}
                    label={{
                      value: 'Settlement Period',
                      position: 'insideBottom',
                      offset: -4,
                      fill: '#6f7a75',
                      fontSize: 12,
                    }}
                  />
                  <YAxis
                    width={58}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#8b9691', fontSize: 12 }}
                    tickFormatter={(value) => numberFormat.format(value)}
                    tickMargin={10}
                    label={{
                      value: 'Generation (MW)',
                      angle: -90,
                      position: 'insideLeft',
                      offset: 8,
                      fill: '#6f7a75',
                      fontSize: 12,
                    }}
                  />
                  <Tooltip
                    content={<GenerationTooltip />}
                    cursor={{ stroke: '#9ab8ad', strokeDasharray: '4 4' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="historicalGeneration"
                    name="Historical"
                    stroke="#0d9075"
                    strokeWidth={2.5}
                    activeDot={{
                      r: 5,
                      fill: '#0d9075',
                      stroke: '#fff',
                      strokeWidth: 3,
                    }}
                    dot={false}
                    isAnimationActive
                  />
                  <Line
                    type="monotone"
                    dataKey="forecastGeneration"
                    name="Forecast"
                    stroke="#6b72c7"
                    strokeWidth={2.5}
                    strokeDasharray="6 5"
                    activeDot={{
                      r: 5,
                      fill: '#6b72c7',
                      stroke: '#fff',
                      strokeWidth: 3,
                    }}
                    dot={false}
                    isAnimationActive
                  />
                  <Brush
                    dataKey="settlementPeriod"
                    height={22}
                    travellerWidth={10}
                    stroke="#0d9075"
                    fill="#f3f7f5"
                    tickFormatter={() => ''}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="chart-hint">
              Hover for actual and forecast values · Forecast error uses complete matching hours
            </p>
          </section>
          <footer className="dashboard-footer">
            <span>Source: Elexon BMRS · FUELHH actuals and WINDFOR forecasts</span>
            <span>Forecast bias = forecast minus hourly average actual</span>
          </footer>
        </>
      )}
    </main>
  )
}

export default App
