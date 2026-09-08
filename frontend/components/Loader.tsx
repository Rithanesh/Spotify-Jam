'use client';

export default function Loader({ label = 'Tuning in…' }: { label?: string }) {
  const bars = [0, 1, 2, 3, 4];
  return (
    <div
      style={{
        height: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: 'var(--bg)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 48 }}>
        {bars.map((i) => (
          <span
            key={i}
            style={{
              display: 'inline-block',
              width: 6,
              borderRadius: 3,
              background: 'var(--accent)',
              animation: `eq-bounce 1.1s ease-in-out ${i * 0.12}s infinite`,
            }}
          />
        ))}
      </div>
      <p className="heading" style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
        {label}
      </p>

      <style jsx>{`
        @keyframes eq-bounce {
          0%, 100% { height: 10px; opacity: 0.6; }
          50% { height: 42px; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
