import { useEffect, useRef, useState } from 'react'

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
}

const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4)

export default function AnimatedNumber({
  value,
  duration = 800,
  format = (n) => n.toLocaleString(),
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    fromRef.current = display
    startRef.current = null

    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now
      const elapsed = now - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutQuart(progress)
      const next = fromRef.current + (value - fromRef.current) * eased
      setDisplay(next)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  return <>{format(display)}</>
}
