<script setup>
/**
 * 会话侧栏横条（复刻 ZCode 左侧小横条导航）：
 * - 每条用户问题对应一根短横线，当前视口内的提问高亮（加深加长）
 * - hover 横线浮出摘要卡：用户提问 + 助手回复摘录（尚未回复时显示「正在回答…」）
 * - 点击横线跳转到对应提问位置（由父组件执行滚动）
 */
defineProps({
  // [{ key, question, answerExcerpt }]
  items: { type: Array, default: () => [] },
  activeKey: { type: String, default: '' },
})
defineEmits(['jump'])
</script>

<template>
  <nav v-if="items.length" class="rail" aria-label="会话提问导航">
    <el-tooltip
      v-for="item in items"
      :key="item.key"
      placement="right-start"
      effect="light"
      :offset="10"
      :show-after="120"
      popper-class="rail-popper"
    >
      <template #content>
        <div class="rail-tip">
          <p class="rail-tip__q">{{ item.question }}</p>
          <p v-if="item.answerExcerpt" class="rail-tip__a">{{ item.answerExcerpt }}</p>
          <p v-else class="rail-tip__a rail-tip__a--pending">正在回答…</p>
        </div>
      </template>
      <button
        type="button"
        class="rail__tick"
        :class="{ 'rail__tick--active': item.key === activeKey }"
        :aria-label="item.question"
        @click="$emit('jump', item.key)"
      />
    </el-tooltip>
  </nav>
</template>

<style scoped>
.rail {
  position: fixed;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 10;
}

.rail__tick {
  width: 18px;
  height: 4px;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: #c6ccd4;
  cursor: pointer;
  transition:
    width 0.2s ease,
    height 0.2s ease,
    background 0.15s;
}

.rail__tick:hover {
  background: #8a929c;
}

/* 默认态所有横条等宽，active 仅以深色区分 */
.rail__tick--active {
  width: 18px;
  height: 5px;
  background: #1f2937;
}

/* hover 横条区时展开：active ×2、其余 ×1.5（宽度过渡动画见 .rail__tick） */
.rail:hover .rail__tick {
  width: 27px;
}

.rail:hover .rail__tick--active {
  width: 36px;
}

/* 窄屏时隐藏，避免压到居中的聊天卡片 */
@media (max-width: 1099px) {
  .rail {
    display: none;
  }
}
</style>

<style>
/* tooltip 内容 teleport 到 body，scoped 样式覆盖不到，这里用全局样式 */
.rail-popper {
  max-width: 320px;
}

.rail-tip {
  max-width: 300px;
}

.rail-tip__q {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #1f2937;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rail-tip__a {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #9ca3af;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
