export default function CampaignsLoading() {
  return (
    <div style={{ padding: '40px 32px' }}>
      <div style={{ height: 28, width: 180, background: '#e8eaed', borderRadius: 4, marginBottom: 8 }} />
      <div style={{ height: 16, width: 320, background: '#f2f3f3', borderRadius: 4, marginBottom: 32 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: '16px 20px', height: 72 }} />
        ))}
      </div>
      <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, height: 200 }} />
    </div>
  )
}
