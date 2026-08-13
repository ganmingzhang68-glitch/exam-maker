import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, InputNumber, Select, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { PracticeMode, PracticeOptions, PracticeSession } from '@exam-maker/shared';
import { createPracticeSession, getPracticeOptions, listPracticeSessions } from '../services/practice';

const { Title, Text } = Typography;
const modeLabels: Record<PracticeMode, string> = { wrong_questions: '错题练习', knowledge_point: '知识点专项', weak_points: '薄弱点练习' };
function errorText(error: unknown) { return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '操作失败'; }

const StudentPractice: React.FC = () => {
  const navigate = useNavigate(); const [form] = Form.useForm();
  const [options, setOptions] = useState<PracticeOptions | null>(null); const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loading, setLoading] = useState(true); const [creating, setCreating] = useState(false);
  const courseId = Form.useWatch('courseId', form); const mode = Form.useWatch('mode', form);
  const course = useMemo(() => options?.courses.find(item => item.id === courseId), [options, courseId]);
  const load = () => Promise.all([getPracticeOptions(), listPracticeSessions()]).then(([nextOptions, nextSessions]) => {
    setOptions(nextOptions); setSessions(nextSessions);
  }).catch(error => message.error(errorText(error))).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  const submit = async (values: { courseId: number; mode: PracticeMode; knowledgePointId?: number; questionCount: number; difficulty?: 'basic' | 'medium' | 'hard' }) => {
    setCreating(true);
    try {
      const session = await createPracticeSession(values);
      if (session.shortageCount) message.warning(session.plan?.shortages[0]?.message ?? `题库缺少 ${session.shortageCount} 道题`);
      if (!session.selectedCount) { setSessions(current => [session, ...current]); return; }
      navigate(`/student/practice/${session.id}`);
    } catch (error) { message.error(errorText(error)); } finally { setCreating(false); }
  };
  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  return <div><Title level={3}>自主练习</Title>
    <Alert showIcon type="info" style={{ marginBottom: 16 }} message="练习题来自已审核题库" description="当前可靠链路只选择有标准答案、可自动判分的客观题。题库不足会明确显示缺口，不会无约束调用 AI 猜题。练习成绩独立于正式考试成绩，但会作为单独证据更新知识点掌握度。" />
    <Card title="创建练习" style={{ marginBottom: 20 }}>
      {options?.courses.length ? <Form form={form} layout="inline" initialValues={{ mode: 'weak_points', questionCount: 10 }} onFinish={submit}>
        <Form.Item name="courseId" label="课程" rules={[{ required: true }]}><Select style={{ width: 180 }} options={options.courses.map(item => ({ value: item.id, label: item.name }))} onChange={() => form.setFieldValue('knowledgePointId', undefined)} /></Form.Item>
        <Form.Item name="mode" label="模式"><Select style={{ width: 150 }} options={Object.entries(modeLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        {mode === 'knowledge_point' && <Form.Item name="knowledgePointId" label="知识点" rules={[{ required: true }]}><Select style={{ width: 180 }} options={(course?.knowledgePoints ?? []).map(item => ({ value: item.id, label: `${item.name}${item.masteryLevel ? ` · ${item.masteryLevel}` : ''}` }))} /></Form.Item>}
        <Form.Item name="difficulty" label="难度"><Select allowClear style={{ width: 110 }} options={[{ value: 'basic', label: '基础' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]} /></Form.Item>
        <Form.Item name="questionCount" label="题量"><InputNumber min={1} max={50} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={creating}>开始练习</Button>
      </Form> : <Text type="secondary">尚未加入任何有效课程，教师将你加入班级后即可创建练习。</Text>}
    </Card>
    <Card title="练习记录"><Table rowKey="id" dataSource={sessions} pagination={{ pageSize: 10 }} columns={[
      { title: '课程', dataIndex: 'courseName' }, { title: '模式', dataIndex: 'mode', render: (value: PracticeMode) => modeLabels[value] },
      { title: '题量', render: (_, row: PracticeSession) => `${row.selectedCount}/${row.requestedCount}${row.shortageCount ? `（缺 ${row.shortageCount}）` : ''}` },
      { title: '成绩', render: (_, row: PracticeSession) => row.status === 'completed' ? `${row.scoreEarned}/${row.scorePossible}` : '—' },
      { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'completed' ? 'green' : value === 'in_progress' ? 'blue' : 'orange'}>{value}</Tag> },
      { title: '操作', render: (_, row: PracticeSession) => <Button type="link" disabled={!row.selectedCount} onClick={() => navigate(`/student/practice/${row.id}`)}>{row.status === 'completed' ? '查看结果' : '继续练习'}</Button> },
    ]} /></Card>
  </div>;
};
export default StudentPractice;
