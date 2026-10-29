import { cn } from "@/lib/utils"

interface LogoProps {
  className?: string
  size?: "sm" | "md" | "lg" | "xl"
}

export function Logo({ className, size = "md" }: LogoProps) {
  const sizeClasses = {
    sm: "h-10",
    md: "h-14",
    lg: "h-20",
    xl: "h-28",
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <img
        src="/brand/livrepay-logo.png"
        alt="LivrePay"
        className={cn("object-contain", sizeClasses[size])}
      />
    </div>
  )
}
