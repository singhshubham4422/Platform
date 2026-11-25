export function NotConfiguredScreen({ reason }: { reason: 'NOT_CONFIGURED' | 'MOCK_OUTSIDE_TEST' }) {
  return (
    <div className="auth-screen">
      <div className="auth-card" role="alert">
        <h1>{reason === 'NOT_CONFIGURED' ? 'Not configured' : 'Configuration refused'}</h1>
        {reason === 'NOT_CONFIGURED' ? (
          <>
            <p>
              This dashboard build has no Supabase project configured. Set <code>VITE_SUPABASE_URL</code> and{' '}
              <code>VITE_SUPABASE_ANON_KEY</code> at build time and publish again.
            </p>
            <p className="muted small">
              There is deliberately no fallback project. The client never ships a service-role key.
            </p>
          </>
        ) : (
          <p>
            The mock data source is only available in a test build. Set <code>VITE_DATA_SOURCE=mock</code> together with
            Vite&apos;s test mode; production builds refuse it.
          </p>
        )}
      </div>
    </div>
  );
}
