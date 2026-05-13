export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-syne font-bold text-text1 mb-2">CBOP</h1>
          <p className="text-text2">Your company. One OS.</p>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-sm p-8">
          <h2 className="text-xl font-syne font-semibold mb-6">Sign In</h2>

          {/* Login form will be implemented in Slice 1 */}
          <p className="text-text2 text-sm text-center">
            Login functionality will be implemented in Slice 1
          </p>
        </div>
      </div>
    </div>
  )
}
