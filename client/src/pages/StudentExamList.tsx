import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { FormOutlined, ReloadOutlined } from '@ant-design/icons';
import type { StudentExamSummary } from '@exam-maker/shared';
import { listStudentExams, startExam } from '../services/exam';

const { Title, Text } = Typography;

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

const availabilityMeta = {
  upcoming: { label: '尚未开始', color: 'default' },
  available: { label: '可参加', color: 'processing' },
  ended: { label: '已结束', color: 'error' },
  completed: { label: '已完成', color: 'success' },
} as const;

const StudentExamList: React.FC = () => {
  const navigate = useNavigate();
  const [exams, setExams] = useState<StudentExamSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingId, setStartingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setExams(await listStudentExams());
    } catch (error) {
      message.error(errorMessage(error, '加载考试列表失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleStart = async (examId: number) => {
    setStartingId(examId);
    try {
      const detail = await startExam(examId);
      navigate(`/attempts/${detail.attempt.id}`);
    } catch (error) {
      message.error(errorMessage(error, '开始考试失败'));
      await load();
    } finally {
      setStartingId(null);
    }
  };

  const canStartAgain = (exam: StudentExamSummary) => {
    const now = Date.now();
    return exam.status === 'published' &&
      (!exam.startAt || now >= new Date(exam.startAt).getTime()) &&
      (!exam.endAt || now < new Date(exam.endAt).getTime()) &&
      exam.attemptCount < exam.allowedAttempts;
  };

  const columns: TableColumnsType<StudentExamSummary> = [
    { title: '考试名称', dataIndex: 'title', ellipsis: true },
    { title: '试卷', dataIndex: 'paperTitle', width: 180, ellipsis: true },
    {
      title: '状态', dataIndex: 'availability', width: 110,
      render: (availability: StudentExamSummary['availability']) => {
        const meta = availabilityMeta[availability];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '考试时间', key: 'time', width: 300,
      render: (_, exam) => `${exam.startAt ? new Date(exam.startAt).toLocaleString('zh-CN') : '-'} ～ ${exam.endAt ? new Date(exam.endAt).toLocaleString('zh-CN') : '-'}`,
    },
    { title: '时长', dataIndex: 'durationMinutes', width: 90, render: (value: number) => `${value} 分钟` },
    { title: '总分', dataIndex: 'totalScore', width: 80, render: (value: number) => `${value} 分` },
    {
      title: '作答次数', key: 'attempts', width: 100,
      render: (_, exam) => `${exam.attemptCount}/${exam.allowedAttempts}`,
    },
    {
      title: '操作', key: 'actions', width: 180,
      render: (_, exam) => {
        if (exam.latestAttempt?.status === 'in_progress') {
          return <Button type="primary" icon={<FormOutlined />} onClick={() => navigate(`/attempts/${exam.latestAttempt!.id}`)}>继续作答</Button>;
        }
        if (exam.latestAttempt && ['submitted', 'grading', 'graded'].includes(exam.latestAttempt.status)) {
          return (
            <Space>
              <Button onClick={() => navigate(`/attempts/${exam.latestAttempt!.id}/result`)}>查看成绩</Button>
              {canStartAgain(exam) && (
                <Button type="primary" loading={startingId === exam.id} onClick={() => handleStart(exam.id)}>再次作答</Button>
              )}
            </Space>
          );
        }
        if (exam.availability === 'available') {
          return <Button type="primary" loading={startingId === exam.id} onClick={() => handleStart(exam.id)}>开始考试</Button>;
        }
        return <Button disabled>{exam.availability === 'upcoming' ? '等待开始' : '不可作答'}</Button>;
      },
    },
  ];

  const current = exams.filter((exam) => ['available', 'upcoming'].includes(exam.availability));
  const history = exams.filter((exam) => ['ended', 'completed'].includes(exam.availability));
  const table = (data: StudentExamSummary[]) => (
    <Table<StudentExamSummary>
      rowKey="id"
      loading={loading}
      columns={columns}
      dataSource={data}
      scroll={{ x: 1150 }}
      pagination={{ pageSize: 10 }}
    />
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>我的考试</Title>
          <Text type="secondary">查看可参加的考试和历史作答。</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </div>
      <Tabs items={[
        { key: 'current', label: `当前考试（${current.length}）`, children: table(current) },
        { key: 'history', label: `已结束与已完成（${history.length}）`, children: table(history) },
      ]} />
    </div>
  );
};

export default StudentExamList;
