import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import type { AnswerContent, AttemptDetail, AttemptQuestionSnapshot } from '@exam-maker/shared';
import { getAttempt, saveAnswer, submitAttempt } from '../services/exam';
import { questionTypeLabels } from '../utils/examLabels';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

function textAnswer(value: AnswerContent | null | undefined): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return Array.isArray(value) ? value.join('，') : JSON.stringify(value);
}

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

const ExamTaking: React.FC = () => {
  const { id } = useParams();
  const attemptId = Number(id);
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [answers, setAnswers] = useState<Record<number, AnswerContent | null>>({});
  const answersRef = useRef<Record<number, AnswerContent | null>>({});
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [saveStates, setSaveStates] = useState<Record<number, 'saving' | 'saved' | 'error'>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [manualSaving, setManualSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!Number.isInteger(attemptId) || attemptId <= 0) {
      navigate('/student/exams', { replace: true });
      return;
    }
    getAttempt(attemptId).then((data) => {
      setDetail(data);
      const initial = Object.fromEntries(data.questions.map((question) => [question.paperQuestionId, null])) as Record<number, AnswerContent | null>;
      data.answers.forEach((answer) => { initial[answer.paperQuestionId] = answer.content; });
      answersRef.current = initial;
      setAnswers(initial);
      if (data.attempt.expiresAt) {
        setRemaining(Math.max(0, Math.ceil((new Date(data.attempt.expiresAt).getTime() - Date.now()) / 1000)));
      }
    }).catch((error) => {
      message.error(errorMessage(error, '加载作答记录失败'));
      navigate('/student/exams', { replace: true });
    }).finally(() => setLoading(false));
    return () => Object.values(timersRef.current).forEach(clearTimeout);
  }, [attemptId, navigate]);

  useEffect(() => {
    if (!detail?.attempt.expiresAt || detail.attempt.status !== 'in_progress') return;
    const timer = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((new Date(detail.attempt.expiresAt!).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [detail?.attempt.expiresAt, detail?.attempt.status]);

  const readOnly = !detail || detail.attempt.status !== 'in_progress' || remaining <= 0;

  const persistOne = async (paperQuestionId: number, notifyFailure = true): Promise<boolean> => {
    setSaveStates((current) => ({ ...current, [paperQuestionId]: 'saving' }));
    try {
      await saveAnswer(attemptId, paperQuestionId, answersRef.current[paperQuestionId] ?? null);
      setSaveStates((current) => ({ ...current, [paperQuestionId]: 'saved' }));
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(paperQuestionId);
        return next;
      });
      return true;
    } catch (error) {
      setSaveStates((current) => ({ ...current, [paperQuestionId]: 'error' }));
      if (notifyFailure) message.error(errorMessage(error, '保存答案失败'));
      return false;
    }
  };

  const changeAnswer = (paperQuestionId: number, content: AnswerContent) => {
    if (readOnly) return;
    const next = { ...answersRef.current, [paperQuestionId]: content };
    answersRef.current = next;
    setAnswers(next);
    setDirtyIds((current) => new Set(current).add(paperQuestionId));
    setSaveStates((current) => ({ ...current, [paperQuestionId]: 'saving' }));
    clearTimeout(timersRef.current[paperQuestionId]);
    timersRef.current[paperQuestionId] = setTimeout(() => { persistOne(paperQuestionId, false); }, 800);
  };

  const saveAll = async (): Promise<boolean> => {
    if (!detail || detail.attempt.status !== 'in_progress') return false;
    if (remaining <= 0) return true;
    setManualSaving(true);
    Object.values(timersRef.current).forEach(clearTimeout);
    try {
      const ids = detail.questions.map((question) => question.paperQuestionId);
      const results = await Promise.all(ids.map((questionId) => persistOne(questionId, false)));
      if (results.every(Boolean)) {
        message.success('答案已全部保存');
        return true;
      }
      message.error('部分答案保存失败，请重试');
      return false;
    } finally {
      setManualSaving(false);
    }
  };

  const confirmSubmit = () => {
    Modal.confirm({
      title: '确认提交试卷？',
      content: `提交后不能继续修改答案。当前还有 ${dirtyIds.size} 道题存在未确认保存的修改。`,
      okText: '确认提交',
      cancelText: '继续作答',
      onOk: async () => {
        setSubmitting(true);
        try {
          const saved = await saveAll();
          if (!saved) throw new Error('答案保存失败，已取消提交');
          const submitted = await submitAttempt(attemptId);
          setDetail(submitted);
          message.success(submitted.idempotent ? '试卷已提交，请勿重复操作' : '试卷提交成功');
          navigate(`/attempts/${attemptId}/result`, { replace: true });
        } catch (error) {
          message.error(errorMessage(error, error instanceof Error ? error.message : '提交失败'));
          throw error;
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const renderAnswer = (question: AttemptQuestionSnapshot) => {
    const value = answers[question.paperQuestionId];
    if (question.type === 'single_choice') {
      return (
        <Radio.Group value={typeof value === 'string' ? value : undefined} disabled={readOnly} onChange={(event) => changeAnswer(question.paperQuestionId, event.target.value)}>
          <Space direction="vertical">
            {(question.options ?? []).map((option) => <Radio key={option} value={option}>{option}</Radio>)}
          </Space>
        </Radio.Group>
      );
    }
    if (question.type === 'multiple_choice') {
      return (
        <Checkbox.Group
          options={question.options ?? []}
          value={Array.isArray(value) ? value : []}
          disabled={readOnly}
          onChange={(selected) => changeAnswer(question.paperQuestionId, selected.map(String))}
        />
      );
    }
    if (question.type === 'true_false') {
      return (
        <Radio.Group value={typeof value === 'string' ? value : undefined} disabled={readOnly} onChange={(event) => changeAnswer(question.paperQuestionId, event.target.value)}>
          <Radio value="true">正确</Radio>
          <Radio value="false">错误</Radio>
        </Radio.Group>
      );
    }
    if (question.type === 'fill_blank') {
      return <Input value={textAnswer(value)} disabled={readOnly} onChange={(event) => changeAnswer(question.paperQuestionId, event.target.value)} />;
    }
    return <TextArea rows={6} value={textAnswer(value)} disabled={readOnly} onChange={(event) => changeAnswer(question.paperQuestionId, event.target.value)} />;
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!detail) return null;
  const submitted = ['submitted', 'grading', 'graded'].includes(detail.attempt.status);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/student/exams')}>返回考试列表</Button>
          <Tag color={submitted ? 'success' : 'processing'}>{submitted ? '已提交' : '作答中'}</Tag>
        </Space>
        <Space size="large">
          {!submitted && <Text strong type={remaining < 300 ? 'danger' : undefined}>剩余时间：{formatRemaining(remaining)}</Text>}
          <Text>总分：{detail.paper.totalScore}</Text>
        </Space>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Title level={3} style={{ marginBottom: 8 }}>{detail.exam.title}</Title>
        <Text type="secondary">{detail.paper.title} · 第 {detail.attempt.attemptNo} 次作答</Text>
        {detail.paper.instructions && <Paragraph style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{detail.paper.instructions}</Paragraph>}
      </Card>

      {submitted && <Alert type="success" showIcon message="试卷已提交，答案已锁定，不能继续修改。" style={{ marginBottom: 16 }} />}
      {!submitted && remaining <= 0 && <Alert type="error" showIcon message="作答时间已结束，不能继续修改答案，请提交试卷。" style={{ marginBottom: 16 }} />}

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {detail.questions.map((question) => {
          const saveState = saveStates[question.paperQuestionId];
          return (
            <Card
              key={question.paperQuestionId}
              title={`${question.orderNo}. ${questionTypeLabels[question.type]}`}
              extra={<Space><Tag>{question.score} 分</Tag>{!submitted && <Text type={saveState === 'error' ? 'danger' : 'secondary'}>{saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已自动保存' : saveState === 'error' ? '保存失败' : ''}</Text>}</Space>}
            >
              <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 16 }}>{question.stem}</Paragraph>
              {renderAnswer(question)}
            </Card>
          );
        })}
      </Space>

      {!submitted && (
        <Card style={{ marginTop: 16, textAlign: 'right' }}>
          <Space>
            <Button icon={<SaveOutlined />} loading={manualSaving} disabled={readOnly} onClick={saveAll}>手动保存</Button>
            <Button type="primary" danger icon={<SendOutlined />} loading={submitting} onClick={confirmSubmit}>提交试卷</Button>
          </Space>
        </Card>
      )}
    </div>
  );
};

export default ExamTaking;
