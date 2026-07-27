import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/webview/lib/utils";

const segmentedVariants = cva(
  "peer group/segmented inline-flex items-center rounded-md bg-muted p-0.5 text-muted-foreground",
  {
    variants: {
      size: {
        default: "h-9 px-1",
        xs: "h-5 rounded-[6px]",
        sm: "h-8 px-1.5",
        lg: "h-10 px-1.5",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

function Segmented({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root> & VariantProps<typeof segmentedVariants>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented"
      data-size={size}
      className={cn(segmentedVariants({ size }), className)}
      {...props}
    />
  );
}

function SegmentedItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="segmented-item"
      className={cn(
        "relative inline-flex flex-1 items-center justify-center rounded-sm group-data-[size=default]/segmented:h-7 group-data-[size=default]/segmented:px-3 group-data-[size=lg]/segmented:h-8 group-data-[size=lg]/segmented:px-4 group-data-[size=lg]/segmented:text-[16px] group-data-[size=sm]/segmented:h-6 group-data-[size=sm]/segmented:px-2 group-data-[size=sm]/segmented:text-xs group-data-[size=xs]/segmented:h-4 group-data-[size=xs]/segmented:px-1.5 group-data-[size=xs]/segmented:text-[10px] gap-1.5 group-data-[size=xs]/segmented:rounded px-3 py-1 text-sm font-medium whitespace-nowrap cursor-pointer transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm",
        className
      )}
      {...props}
    />
  );
}

export { Segmented, SegmentedItem };
