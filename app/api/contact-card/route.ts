import { appUrl } from '@/src/lib/env'

function escapeVCard(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

export async function GET() {
  const phone = process.env.TWILIO_FROM_NUMBER?.trim()

  if (!phone) {
    return new Response('Manoa phone number is not configured yet.', { status: 503 })
  }

  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCard('Manoa')}`,
    `ORG:${escapeVCard('Manoa')}`,
    `TEL;TYPE=CELL:${escapeVCard(phone)}`,
    `URL:${escapeVCard(appUrl())}`,
    `NOTE:${escapeVCard('Text Manoa to schedule, reschedule, and get your day by text.')}`,
    'END:VCARD',
    '',
  ].join('\n')

  return new Response(vcard, {
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': 'attachment; filename="manoa.vcf"',
      'Cache-Control': 'no-store',
    },
  })
}
