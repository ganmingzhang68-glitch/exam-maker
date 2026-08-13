import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Progress, Radio, Space, Spin, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import type { AnswerContent, PracticeQuestion, PracticeSession } from '@exam-maker/shared';
import { getPracticeSession, submitPracticeAnswer } from '../services/practice';

const { Title, Text, Paragraph } = Typography; const { TextArea } = Input;
function errorText(error: unknown) { return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '操作失败'; }

const StudentPracticeSession: React.FC = () => {
  const id = Number(useParams().id); const navigate = useNavigate(); const [session, setSession] = useState<PracticeSession | null>(null);
  const [answers, setAnswers] = useState<Record<number, AnswerContent | null>>({}); const [submitting, setSubmitting] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  useEffect(() => { getPracticeSession(id).then(setSession).catch(error => { message.error(errorText(error)); navigate('/student/practice'); }); }, [id, navigate]);
  if (!session) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  const answered = session.questions?.filter(item => item.status === 'graded').length ?? 0;
  const change = (itemId: number, content: AnswerContent) => setAnswers(current => ({ ...current, [itemId]: content }));
  const submit = async (question: PracticeQuestion) => {
    setSubmitting(question.id);
    try { const next = await submitPracticeAnswer(session.id, question.id, answers[question.id] ?? null, Math.floor((Date.now() - startedAt.current) / 1000)); setSession(next); startedAt.current = Date.now(); }
    catch (error) { message.error(errorText(error)); } finally { setSubmitting(null); }
  };
  const renderInput = (question: PracticeQuestion) => question.type === 'single_choice'
    ? <Radio.Group value={answers[question.id]} onChange={event => change(question.id, event.target.value)}><Space direction="vertical">{(question.options ?? []).map(option => <Radio key={option} value={option}>{option}</Radio>)}</Space></Radio.Group>
    : question.type === 'multiple_choice' ? <Checkbox.Group options={question.options ?? []} value={Array.isArray(answers[question.id]) ? answers[question.id] as string[] : []} onChange={value => change(question.id, value.map(String))} />
      : question.type === 'true_false' ? <Radio.Group value={answers[question.id]} onChange={event => change(question.id, event.target.value)} options={[{ value: '正确', label: '正确' }, { value: '错误', label: '错误' }]} />
        : <TextArea rows={2} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={event => change(question.id, event.target.value)} />;
  return <div><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/student/practice')}>返回练习</Button>
    <Title level={3} style={{ marginTop: 16 }}>{session.courseName} · 自主练习</Title>
    {session.shortageCount > 0 && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={session.plan?.shortages[0]?.message ?? `题库缺少 ${session.shortageCount} 道题`} />}
    <Progress percent={session.selectedCount ? Math.round(answered / session.selectedCount * 100) : 0} />
    {(session.questions ?? []).map(question => <Card key={question.id} style={{ marginTop: 16 }} title={`${question.orderNo}. ${question.knowledgePointNames.join('、') || '未分类'}`} extra={<Tag>{question.maxScore} 分</Tag>}>
      <Paragraph>{question.stem}</Paragraph>
      {question.status !== 'graded' ? <><div style={{ marginBottom: 16 }}>{renderInput(question)}</div><Button type="primary" loading={submitting === question.id} onClick={() => submit(question)}>提交本题</Button></>
        : <Alert type={question.isCorrect ? 'success' : 'error'} showIcon message={question.isCorrect ? `回答正确，得 ${question.score} 分` : `回答错误，得 ${question.score} 分`} description={session.status === 'completed' ? <Space direction="vertical"><Text>标准答案：{JSON.stringify(question.answerKey)}</Text>{question.analysis && <Text>解析：{question.analysis}</Text>}</Space> : '完成整组练习后显示标准答案和解析。'} />}
    </Card>)}
    {session.status === 'completed' && <Alert style={{ marginTop: 20 }} type="success" showIcon message={`练习完成：${session.scoreEarned}/${session.scorePossible} 分`} description="本次练习已作为练习证据更新知识点掌握度，不会计入正式考试成绩。" />}
  </div>;
};
export default StudentPracticeSession;
