import React from "react";

export default function StrategyBar({ content }) {
  if (!content) return null;

  return (
    <div className="max-w-[1100px] mx-auto mt-10 mb-12">
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl px-8 py-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-lg">💡</span>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-3">
              全局复盘报告 · 核心破局点
            </h3>
            <p className="text-sm text-amber-900/80 leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
