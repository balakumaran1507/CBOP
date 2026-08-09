export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-md">
      <div className="flex flex-col items-center gap-4">
        {/* Apple-style spinner */}
        <div className="relative flex items-center justify-center w-12 h-12">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="absolute w-[3px] h-3 bg-text1/40 rounded-full"
              style={{
                transform: `rotate(${i * 30}deg) translateY(-14px)`,
                animation: `spinner-fade 1.2s linear infinite`,
                animationDelay: `${(i * 1.2) / 12}s`
              }}
            />
          ))}
        </div>
        <p className="text-sm font-medium text-text2 animate-pulse">
          Loading...
        </p>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes spinner-fade {
            0% { opacity: 1; }
            100% { opacity: 0.15; }
          }
        `
      }} />
    </div>
  )
}
