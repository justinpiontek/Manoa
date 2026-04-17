import Image from 'next/image'
import wordmark from '@/src/assets/manoa-wordmark.png'

type ManoaWordmarkProps = {
  href?: string
  className?: string
  priority?: boolean
}

export default function ManoaWordmark({
  href = '/',
  className = '',
  priority = false,
}: ManoaWordmarkProps) {
  const classes = ['manoa-wordmark', className].filter(Boolean).join(' ')

  return (
    <a className={classes} href={href} aria-label="Manoa home">
      <Image
        src={wordmark}
        alt="Manoa"
        className="manoa-wordmark-image"
        priority={priority}
        sizes="(max-width: 620px) 150px, 210px"
      />
    </a>
  )
}
