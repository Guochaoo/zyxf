import { AlignLeft, CodeXml, Disc, Grip, MoveUpRight, Plus, Waves } from 'lucide-react';
import { BsLightningChargeFill } from 'react-icons/bs';

/**
 * LogoIcon — AboutPage 跑马灯装饰图形
 *
 * 全部改为引用图标包，不再包含手写 SVG 路径：
 * - code/dots/circle-ring/arrow/plus：lucide 对应图标
 * - bolt：bootstrap 的直线闪电（比 lucide Zap 的形状更接近原始设计）
 * - wave-circle：包内无"圆内正弦波"对应物，以 lucide Waves 近似（保留波形、省略外圈）
 * - lines：包内无"三段错位横线"对应物，以 lucide AlignLeft 近似（保留长短阶梯）
 */
export default function LogoIcon({ type }) {
  switch (type) {
    case 'code':
      return <CodeXml size={22} />;
    case 'dots':
      return <Grip size={20} fill="currentColor" />;
    case 'circle-ring':
      return <Disc size={22} />;
    case 'arrow':
      // ArrowUpRight 的墨迹只占画布四分之一象限(42%)，与同排满宽图形相比明显偏小；
      // MoveUpRight 斜线贯穿画布(58%)，取 26px 使实际墨迹(~15px)对齐邻居。
      return <MoveUpRight size={26} />;
    case 'wave-circle':
      return <Waves size={22} />;
    case 'lines':
      return <AlignLeft size={20} />;
    case 'bolt':
      return <BsLightningChargeFill size={16} />;
    case 'plus':
    default:
      return <Plus size={18} strokeWidth={3} />;
  }
}
