import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Space, Table, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { ArrowLeftOutlined, FormOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Attempt, TeacherExamStudentResult } from '@exam-maker/shared';
import { listExamResults, listTeacherExams } from '../services/exam';

const { Title, Text } = Typography;

interface ResultRow {
  key: string;
  student: TeacherExamStudentResult['student'];
  attempt: Attempt | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

const ExamResults: React.FC = () => {
  const { id } = useParams();
  const examId = Number(id);
  const navigate = useNavigate();
  const [title, setTitle] = useState('考试成绩');
  const [students, setStudents] = useState<TeacherExamStudentResult[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [rows, exams] = await Promise.all([listExamResults(examId), listTeacherExams()]);
      setStudents(rows);
      setTitle(exams.find((exam) => exam.id === examId)?.title ?? '考试成绩');
    } catch (error) {
      message.error(errorMessage(error, '加载成绩失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [examId]);

  const rows = useMemo<ResultRow[]>(() => students.reduce<ResultRow[]>((all, item) => {
    if (item.attempts.length) {
      all.push(...item.attempts.map((attempt) => ({
        key: `${item.student.id}-${attempt.id}`,
        student: item.student,
        attempt,
      })));
    } else {
      all.push({ key: `${item.student.id}-none`, student: item.student, attempt: null });
    }
    return all;
  }, []), [students]);

  const columns: TableColumnsType<ResultRow> = [
    { title: '学生', key: 'student', render: (_, row) => <div><Text strong>{row.student.username}</Text><br /><Text type="secondary">{row.student.email}</Text></div> },
    { title: '作答次数', key: 'attemptNo', width: 100, render: (_, row) => row.attempt ? `第 ${row.attempt.attemptNo} 次` : '-' },
    {
      title: '状态', key: 'status', width: 110,
      render: (_, row) => row.attempt
        ? <Tag color={row.attempt.status === 'graded' ? 'success' : row.attempt.status === 'grading' ? 'warning' : 'default'}>{row.attempt.status === 'graded' ? '已完成批改' : row.attempt.status === 'grading' ? '待人工批改' : row.attempt.status}</Tag>
        : <Tag>未作答</Tag>,
    },
    { title: '客观题', key: 'objective', width: 100, render: (_, row) => row.attempt ? `${row.attempt.objectiveScore} 分` : '-' },
    { title: '主观题', key: 'subjective', width: 100, render: (_, row) => row.attempt ? `${row.attempt.subjectiveScore} 分` : '-' },
    { title: '总分', key: 'total', width: 100, render: (_, row) => row.attempt ? <Text strong>{row.attempt.totalScore} 分</Text> : '-' },
    { title: '提交时间', key: 'submittedAt', width: 180, render: (_, row) => row.attempt?.submittedAt ? new Date(row.attempt.submittedAt).toLocaleString('zh-CN') : '-' },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_, row) => row.attempt && ['grading', 'graded', 'submitted'].includes(row.attempt.status)
        ? <Button icon={<FormOutlined />} onClick={() => navigate(`/exams/${examId}/attempts/${row.attempt!.id}/grade`)}>查看/批改</Button>
        : null,
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/exams')}>返回考试管理</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </Space>
      <Title level={4} style={{ marginBottom: 4 }}>{title}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>查看学生提交状态、自动判分结果和人工批改进度。</Text>
      <Table<ResultRow>
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条作答记录` }}
      />
    </div>
  );
};

export default ExamResults;
