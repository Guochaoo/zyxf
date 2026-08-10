import { BookOpenCheck, GraduationCap, HeartHandshake, UsersRound } from 'lucide-react';

const highlights = [
  {
    title: '学业支持',
    text: '围绕课程学习、资料整理、答疑辅导和经验分享，帮助同学更稳地完成阶段性学习目标。',
    icon: BookOpenCheck,
  },
  {
    title: '同伴互助',
    text: '由学生骨干和志愿力量共同参与，把个人经验转化为可复用、可传递的学习支持。',
    icon: UsersRound,
  },
  {
    title: '持续沉淀',
    text: '建设和维护学辅资料库，让课程资料、学习方法和辅导成果能够长期留存。',
    icon: HeartHandshake,
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <section className="rb-card rounded-lg bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex w-11 h-11 items-center justify-center rounded-lg bg-brand-600/10">
              <GraduationCap className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em]">
                仲英书院学业辅导中心
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                仲英书院学业辅导中心面向书院同学开展学业支持工作，致力于把课程学习、同伴互助和资料共建连接起来，
                为同学们提供更清晰、更可持续的学习帮助。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {highlights.map(({ title, text, icon: Icon }) => (
          <article
            key={title}
            className="rb-card rounded-lg bg-white p-5 transition-shadow hover:shadow-[rgba(0,0,0,0.08)_0px_0px_0px_1px,rgba(0,0,0,0.08)_0px_2px_4px,rgba(0,0,0,0.04)_0px_8px_8px_-8px,#fafafa_0px_0px_0px_1px]"
          >
            <div className="mb-4 inline-flex w-10 h-10 items-center justify-center rounded-lg bg-brand-600/10">
              <Icon className="w-5 h-5 text-brand-600" />
            </div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
          </article>
        ))}
      </section>

      <section className="rb-card rounded-lg bg-white p-6 sm:p-7">
        <h2 className="text-base font-semibold">我们在做什么</h2>
        <div className="mt-4 grid gap-3 text-sm leading-7 text-slate-600 sm:grid-cols-2">
          <p>整理课程资料与学习资源，降低同学查找和复习成本。</p>
          <p>组织学业辅导、经验交流和专题分享，支持不同阶段的学习需求。</p>
          <p>维护资料库内容秩序，让文件分类、预览和下载更高效。</p>
          <p>持续收集反馈，推动学业支持服务更加贴近同学真实场景。</p>
        </div>
      </section>
    </div>
  );
}
