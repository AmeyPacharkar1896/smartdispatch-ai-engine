import { useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

type TravelSummary = Record<string, string | number | null | undefined>
type PriceSummary = Record<string, string | number | null | undefined>
type Comparison = Record<string, unknown>

export type BatchEvalResponse = {
  created_at: string
  n_requested: number
  n_completed: number
  n_skipped: number
  seed: number | null
  travel_time: TravelSummary
  pricing: PriceSummary
  comparison: Comparison
  saved_to?: string
  charts_generated?: boolean
  charts_directory?: string
  charts_error?: string
  rows?: unknown[]
}

export default function BatchEvalTab() {
  const [n, setN] = useState(25)
  const [seed, setSeed] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BatchEvalResponse | null>(null)

  const runBatch = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const body: { n: number; seed?: number } = { n }
      const s = seed.trim() === '' ? undefined : Number.parseInt(seed, 10)
      if (s !== undefined && !Number.isNaN(s)) body.seed = s

      const res = await fetch(`${API_BASE}/simulation/batch-eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as BatchEvalResponse & { detail?: string }
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`)
        return
      }
      setResult(data)
    } catch {
      setError('Request failed — is the API running on port 8000?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="batch-eval">
      <p className="batch-eval-intro">
        Monte Carlo over random pickup/drop pairs (same Mumbai POIs as the map). Travel error is vs{' '}
        <strong>OSRM</strong> duration; pricing error is vs the <strong>same synthetic pricing formula</strong> as{' '}
        <code>ml/01_data_generation.ipynb</code> (deterministic; aligns with{' '}
        <code>pricing_synthetic.csv</code> / the pricing model&rsquo;s training objective). Results are saved under{' '}
        <code>simulation_performance/</code> and compared to{' '}
        <code>docs/evaluation_report.json</code>. After each batch, charts matching the style of{' '}
        <code>docs/charts/</code> are written to <code>docs/charts/simulation/</code> (or run{' '}
        <code>python scripts/plot_simulation_performance.py</code> from the repo root).
      </p>

      <div className="batch-eval-controls">
        <label htmlFor="batch-n">
          Number of simulations
          <input
            id="batch-n"
            type="number"
            min={1}
            max={500}
            value={n}
            onChange={(e) => setN(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <label htmlFor="batch-seed">
          Seed (optional)
          <input
            id="batch-seed"
            type="text"
            inputMode="numeric"
            placeholder="random"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={runBatch} disabled={loading}>
          {loading ? 'Running…' : 'Run batch evaluation'}
        </button>
      </div>

      {error && (
        <p className="batch-eval-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="batch-eval-results">
          <p className="batch-meta">
            Completed {result.n_completed} / {result.n_requested} samples
            {result.n_skipped ? ` (${result.n_skipped} skipped, no route)` : ''}
            {result.saved_to ? ` · saved ${result.saved_to}` : ''}
            {result.charts_generated && result.charts_directory ? (
              <> · charts → {result.charts_directory}/</>
            ) : result.charts_error ? (
              <> · charts failed (see API / re-run plot script)</>
            ) : null}
          </p>
          {result.charts_error && (
            <pre className="batch-json batch-charts-err">{result.charts_error}</pre>
          )}

          <h3>Travel time (vs OSRM)</h3>
          <pre className="batch-json">{JSON.stringify(result.travel_time, null, 2)}</pre>

          <h3>Pricing (vs training synthetic reference)</h3>
          <pre className="batch-json">{JSON.stringify(result.pricing, null, 2)}</pre>

          <h3>Notebook vs this batch</h3>
          <pre className="batch-json">{JSON.stringify(result.comparison, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
