import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          borderRadius: 32,
          border: '2px solid #D8DEE8',
          color: '#2457C5',
          fontSize: 96,
          fontWeight: 800,
          fontFamily: 'Inter, Arial, sans-serif',
        }}
      >
        M
      </div>
    ),
    {
      width: 180,
      height: 180,
    },
  )
}
