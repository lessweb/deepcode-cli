"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";

interface Props {
  value: number;
  size?: number;
  stroke?: number;
  format?: false | ((value: number) => string);
}

export function ProgressRing({ value, size = 140, stroke = 10, format = false }: Props) {
  const radius = (size - stroke) / 2;

  const circumference = 2 * Math.PI * radius;

  const progress = Math.min(Math.max(value, 0), 100);

  const offset = circumference - (progress / 100) * circumference;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
      }}
    >
      {/* Glow */}
      <motion.div
        animate={{
          scale: [1, 1.08, 1],
          opacity: [0.5, 1, 0.5],
        }}
        transition={{
          repeat: Infinity,
          duration: 2,
          ease: "easeInOut",
        }}
        className="absolute inset-0 rounded-full blur-xl"
        style={{
          background: "radial-gradient(circle,#3b82f655 0%,transparent 70%)",
        }}
      />

      <svg width={size} height={size} className="absolute -rotate-90">
        <defs>
          <linearGradient id="ringGradient">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="50%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>

          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#ffffffff" />
          </filter>
        </defs>

        {/* Track */}

        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} stroke="var(--muted)" fill="none" />

        {/* Progress */}

        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          stroke="url(#ringGradient)"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          filter="url(#shadow)"
          animate={{
            strokeDashoffset: offset,
          }}
          transition={{
            duration: 0.6,
            ease: "easeOut",
          }}
        />
      </svg>

      {format && (
        <AnimatePresence mode="wait">
          {progress < 100 ? (
            <motion.div
              key="text"
              initial={{
                opacity: 0,
                scale: 0.8,
              }}
              animate={{
                opacity: 1,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                scale: 0.8,
              }}
              className="absolute"
            >
              <div className="text-center">
                <div className="text-3xl font-bold">{progress}</div>

                <div className="text-xs text-muted-foreground">%</div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="check"
              initial={{
                scale: 0,
                rotate: -180,
              }}
              animate={{
                scale: 1,
                rotate: 0,
              }}
              transition={{
                type: "spring",
                stiffness: 300,
              }}
              className="absolute"
            >
              <Check className="h-12 w-12 text-green-500" strokeWidth={3} />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
