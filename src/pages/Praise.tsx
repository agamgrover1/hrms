import { useState } from 'react';
import { Award, Plus } from 'lucide-react';
import PraiseWall from '../components/praise/PraiseWall';
import GivePraiseModal from '../components/praise/GivePraiseModal';

// Full praise history page — one big feed, filter by window.

const RANGES: Array<{ id: number; label: string }> = [
  { id: 7,   label: 'Last 7 days' },
  { id: 30,  label: 'Last 30 days' },
  { id: 90,  label: 'Last quarter' },
  { id: 365, label: 'This year' },
];

export default function Praise() {
  const [showGive, setShowGive] = useState(false);
  const [range, setRange] = useState(30);
  const [refresh, setRefresh] = useState(0);   // bump to force PraiseWall reload

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface flex items-center gap-2">
            <Award size={20} className="text-accent" /> Team praise
          </h1>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Peer-to-peer shout-outs. Anyone can send. Everyone can react + comment.
          </p>
        </div>
        <button onClick={() => setShowGive(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 shadow-elev-1">
          <Plus size={14} /> Give a shout-out
        </button>
      </div>

      <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-lg p-0.5">
        {RANGES.map(r => (
          <button key={r.id} onClick={() => setRange(r.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              range === r.id ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'
            }`}>
            {r.label}
          </button>
        ))}
      </div>

      <PraiseWall
        key={`${range}-${refresh}`}
        mode="page"
        sinceDays={range}
        limit={200}
        onGive={() => setShowGive(true)}
      />

      {showGive && (
        <GivePraiseModal
          onClose={() => setShowGive(false)}
          onSaved={() => { setShowGive(false); setRefresh(r => r + 1); }}
        />
      )}
    </div>
  );
}
