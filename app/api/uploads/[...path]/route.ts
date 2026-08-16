import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import { auth } from '@/api/lib/auth'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')

const MIME: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc':  'application/msword',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  // Allow public access to user avatars since they are displayed on the lockscreen before login
  const isPublic = params.path[0] === 'avatars'
  if (!isPublic) {
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  // path.resolve normalises '..' before the guard runs
  const file = path.resolve(UPLOADS_DIR, params.path.join('/'))

  // Trailing sep prevents prefix-spoofing (e.g. /uploads-evil starts with /uploads)
  if (!file.startsWith(UPLOADS_DIR + path.sep)) {
    return new NextResponse('Not found', { status: 404 })
  }

  if (!fs.existsSync(file)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const ext         = path.extname(file).toLowerCase()
  const contentType = MIME[ext] ?? 'application/octet-stream'
  const data        = await fs.promises.readFile(file)

  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': 'inline',
      'Cache-Control':       'private, max-age=3600',
      // Allow same-origin iframe embedding (overrides next.config.js DENY for this route)
      'X-Frame-Options':     'SAMEORIGIN',
    },
  })
}
