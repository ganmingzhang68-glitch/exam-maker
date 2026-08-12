import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, Descriptions, Empty, Form, Input, InputNumber,
  Progress, Radio, Row, Select, Space, Spin, Steps, Tag, Typography, Upload, message,
} from 'antd';
import {
  CheckCircleOutlined, CloudUploadOutlined, DatabaseOutlined, ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import type { SimilarQuestionJob, SimilarQuestionResultItem } from '@exam-maker/shared';
import {
  createSimilarQuestionJob, getSimilarQuestionJob, listSimilarQuestionJobs,
  retrySimilarQuestionJob, saveSimilarQuestionResults,
} from '../services/similarQuestion';

const { Dragger } = Upload;
const { Text, Title, Paragraph } = Typography;

const stageOrder = [
  'question_parsing', 'taxonomy_generation', 'classification', 'question_generation',
  'answer_and_rubric_generation', 'independent_validation',
] as const;

const stageLabels: Record<string, string> = {
  question_parsing: '识别并切分原题',
  taxonomy_generation: '提取课程考点',
  classification: '判定考点和难度',
  question_generation: '按变式轴生成新题',
  answer_and_rubric_generation: '独立生成答案和评分标准',
  independent_validation: '独立质量校验',
};

const questionTypeLabels: Record<string, string> = {
  single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题',
  fill_blank: '填空题', short_answer: '简答题', calculation: '计算题', essay: '论述题',
};

interface FormValues {
  course: string;
  scope?: string;
  sourceText: string;
  sourceAnswer?: string;
  variantsPerQuestion: number;
  defaultScore: number;
  difficultyMode: 'same' | 'lower' | 'higher';
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) return response.data.error;
  }
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

function blockText(blocks: Array<{ content?: string }>): string {
  return blocks.map(block => block.content ?? '').filter(Boolean).join('\n');
}

function answerText(answer: Record<string, unknown>): string {
  if (answer.kind === 'single_choice') return String(answer.optionId ?? '');
  if (answer.kind === 'multiple_choice') return Array.isArray(answer.optionIds) ? answer.optionIds.join('、') : '';
  if (answer.kind === 'boolean') return answer.value ? '正确' : '错误';
  if (answer.kind === 'text') return Array.isArray(answer.accepted) ? answer.accepted.join('；') : '';
  if (answer.kind === 'numeric') return `${answer.value ?? ''}${answer.unit ? ` ${answer.unit}` : ''}`;
  if (answer.kind === 'expression') return String(answer.latex ?? '');
  if (answer.kind === 'subjective') return Array.isArray(answer.keyPoints) ? answer.keyPoints.join('；') : '';
  return JSON.stringify(answer);
}

const ResultCard: React.FC<{
  item: SimilarQuestionResultItem;
  selected: boolean;
  onSelected: (checked: boolean) => void;
}> = ({ item, selected, onSelected }) => (
  <Card
    title={
      <Space wrap>
        <Checkbox checked={selected} disabled={item.savedQuestionId !== null} onChange={event => onSelected(event.target.checked)} />
        <span>原题 {item.sourceQuestionNo} 的变式题</span>
        <Tag color="blue">{questionTypeLabels[item.questionType] ?? item.questionType}</Tag>
        <Tag>{item.score} 分</Tag>
        {item.savedQuestionId && <Tag color="green">已进入审核 #{item.savedQuestionId}</Tag>}
      </Space>
    }
    style={{ marginBottom: 16 }}
  >
    <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 16 }}>{blockText(item.stem)}</Paragraph>
    {item.options.map(option => (
      <Paragraph key={option.id} style={{ marginLeft: 16 }}>
        <Text strong>{option.id}.</Text> {blockText(option.content)}
      </Paragraph>
    ))}
    {item.subquestions.map(subquestion => (
      <Paragraph key={subquestion.id} style={{ marginLeft: 16, whiteSpace: 'pre-wrap' }}>
        {subquestion.label ?? subquestion.id}（{subquestion.score} 分） {blockText(subquestion.stem)}
      </Paragraph>
    ))}
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label="考点">{item.knowledgePoints.join('、')}</Descriptions.Item>
      <Descriptions.Item label="参考答案">{answerText(item.answer)}</Descriptions.Item>
      <Descriptions.Item label="答案解释">{item.explanation.join('\n')}</Descriptions.Item>
      <Descriptions.Item label="评分标准">
        {item.rubric.items.map((rubric, index) => (
          <div key={index}>{String(rubric.criterion ?? rubric.description ?? `评分点 ${index + 1}`)}：{String(rubric.points ?? 0)} 分</div>
        ))}
      </Descriptions.Item>
      <Descriptions.Item label="原创性">
        相似度 {(item.originality.similarity * 100).toFixed(1)}%；变式方式：{item.originality.variationAxis}
      </Descriptions.Item>
      <Descriptions.Item label="质量校验"><Tag color="green">通过</Tag></Descriptions.Item>
    </Descriptions>
  </Card>
);

const SimilarQuestionGenerator: React.FC = () => {
  const [form] = Form.useForm<FormValues>();
  const [job, setJob] = useState<SimilarQuestionJob | null>(null);
  const [history, setHistory] = useState<SimilarQuestionJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  const refreshHistory = useCallback(async () => {
    try { setHistory(await listSimilarQuestionJobs()); } catch { /* 页面主流程不因历史列表失败而中断 */ }
  }, []);

  const loadJob = useCallback(async (id: number) => {
    const loaded = await getSimilarQuestionJob(id);
    setJob(loaded);
    setHistory(current => current.some(item => item.id === loaded.id)
      ? current.map(item => item.id === loaded.id ? loaded : item)
      : [loaded, ...current]);
    localStorage.setItem('lastSimilarQuestionJobId', String(id));
    if (loaded.result?.items) {
      setSelected(loaded.result.items.filter(item => item.savedQuestionId === null).map(item => item.generatedQuestionId));
    }
    return loaded;
  }, []);

  useEffect(() => {
    void refreshHistory();
    const remembered = Number(localStorage.getItem('lastSimilarQuestionJobId'));
    if (Number.isInteger(remembered) && remembered > 0) {
      loadJob(remembered).catch(() => localStorage.removeItem('lastSimilarQuestionJobId'));
    }
  }, [loadJob, refreshHistory]);

  useEffect(() => {
    if (!job || (job.status !== 'pending' && job.status !== 'running')) return;
    const timer = window.setInterval(() => {
      loadJob(job.id).catch(error => message.error(errorMessage(error)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, loadJob]);

  const completedStages = useMemo(() => new Set(
    job?.stages.filter(stage => stage.status === 'succeeded').map(stage => stage.stage) ?? [],
  ), [job?.stages]);
  const latestStageRuns = useMemo(() => new Map(
    (job?.stages ?? []).map(stage => [stage.stage, stage]),
  ), [job?.stages]);
  const progress = Math.round((completedStages.size / stageOrder.length) * 100);

  const submit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const created = await createSimilarQuestionJob({
        ...values,
        scope: values.scope || null,
        sourceAnswer: values.sourceAnswer || null,
      });
      setJob(created);
      setSelected([]);
      localStorage.setItem('lastSimilarQuestionJobId', String(created.id));
      message.success('任务已创建，AI 正在分阶段生成');
      await refreshHistory();
    } catch (error) { message.error(errorMessage(error)); }
    finally { setSubmitting(false); }
  };

  const retry = async () => {
    if (!job) return;
    try {
      setJob(await retrySimilarQuestionJob(job.id));
      message.success('已从最近成功阶段继续执行');
    } catch (error) { message.error(errorMessage(error)); }
  };

  const save = async () => {
    if (!job || selected.length === 0) return;
    setSaving(true);
    try {
      const updated = await saveSimilarQuestionResults(job.id, selected);
      setJob(updated);
      message.success('所选题目已进入 AI 题目审核');
      await refreshHistory();
    } catch (error) { message.error(errorMessage(error)); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Title level={2}><RobotOutlined /> 快速仿题</Title>
      <Paragraph type="secondary">
        输入或上传已有题目，系统先识别题目与考点，再改变设问形态生成新题；答案、评分标准和质量校验均在独立阶段完成。
      </Paragraph>

      <Row gutter={24} align="top">
        <Col xs={24} lg={10}>
          <Card title="1. 输入已有题目">
            <Form<FormValues>
              form={form}
              layout="vertical"
              initialValues={{ variantsPerQuestion: 1, defaultScore: 10, difficultyMode: 'same' }}
              onFinish={submit}
            >
              <Form.Item name="course" label="课程名称" rules={[{ required: true, message: '请输入课程名称' }]}>
                <Input placeholder="例如：高等数学（上）" maxLength={200} />
              </Form.Item>
              <Form.Item name="scope" label="课程范围（可选）">
                <Input placeholder="例如：极限、导数与积分" maxLength={5000} />
              </Form.Item>
              <Form.Item label="从文本文件载入">
                <Dragger
                  accept=".md,.txt,.tex"
                  maxCount={1}
                  showUploadList={false}
                  beforeUpload={file => {
                    file.text().then(text => {
                      form.setFieldValue('sourceText', text);
                      message.success(`已读取 ${file.name}`);
                    }).catch(() => message.error('文件读取失败'));
                    return Upload.LIST_IGNORE;
                  }}
                >
                  <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
                  <p>点击或拖入 Markdown、TXT、TeX 题目文件</p>
                </Dragger>
              </Form.Item>
              <Form.Item name="sourceText" label="已有题目" rules={[{ required: true, min: 3, message: '请输入至少一道已有题目' }]}>
                <Input.TextArea rows={12} placeholder={'1. 求函数 f(x)=... 的导数。\n\n2. ...'} showCount maxLength={200000} />
              </Form.Item>
              <Form.Item name="sourceAnswer" label="原题答案（可选，仅作为来源记录，不会复制到新题）">
                <Input.TextArea rows={3} maxLength={100000} />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="variantsPerQuestion" label="每道原题生成数量">
                    <InputNumber min={1} max={5} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="defaultScore" label="原题未标分时默认分值">
                    <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="difficultyMode" label="新题难度">
                <Radio.Group buttonStyle="solid">
                  <Radio.Button value="lower">降低</Radio.Button>
                  <Radio.Button value="same">相近</Radio.Button>
                  <Radio.Button value="higher">提高</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<RobotOutlined />} loading={submitting} block size="large">
                开始生成类似题目
              </Button>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card
            title="2. 生成进度与结果"
            extra={history.length > 0 && (
              <Select
                aria-label="历史任务"
                value={job?.id}
                placeholder="历史任务"
                style={{ width: 220 }}
                options={history.map(item => ({ value: item.id, label: `#${item.id} ${item.course} · ${item.status}` }))}
                onChange={id => loadJob(id).catch(error => message.error(errorMessage(error)))}
              />
            )}
          >
            {!job && <Empty description="提交已有题目后，这里会显示每个处理阶段和生成结果" />}
            {job && (
              <>
                <Space style={{ marginBottom: 16 }} wrap>
                  <Text strong>任务 #{job.id}</Text>
                  <Tag color={job.status === 'failed' ? 'red' : job.status === 'succeeded' || job.status === 'saved' ? 'green' : 'processing'}>
                    {job.status}
                  </Tag>
                  {(job.status === 'pending' || job.status === 'running') && <Spin size="small" />}
                </Space>
                <Progress percent={job.status === 'failed' ? progress : job.status === 'succeeded' || job.status === 'saved' ? 100 : progress} status={job.status === 'failed' ? 'exception' : 'active'} />
                <Steps
                  direction="vertical"
                  size="small"
                  current={Math.max(0, stageOrder.indexOf(job.currentStage as typeof stageOrder[number]))}
                  items={stageOrder.map(stage => {
                    const latest = latestStageRuns.get(stage);
                    return {
                      title: stageLabels[stage],
                      status: latest?.status === 'failed' ? 'error' : completedStages.has(stage) ? 'finish' : job.currentStage === stage ? 'process' : 'wait',
                      description: latest?.status === 'failed' ? latest.errorMessage ?? undefined : undefined,
                    };
                  })}
                />
                {job.status === 'failed' && (
                  <Alert
                    type="error"
                    showIcon
                    message="生成失败"
                    description={job.errorSummary ?? '未知错误'}
                    action={<Button danger icon={<ReloadOutlined />} onClick={retry}>从断点重试</Button>}
                    style={{ marginBottom: 16 }}
                  />
                )}
                {job.result?.items.map(item => (
                  <ResultCard
                    key={item.generatedQuestionId}
                    item={item}
                    selected={selected.includes(item.generatedQuestionId)}
                    onSelected={checked => setSelected(current => checked
                      ? [...new Set([...current, item.generatedQuestionId])]
                      : current.filter(id => id !== item.generatedQuestionId))}
                  />
                ))}
                {job.status === 'succeeded' && (
                  <Button
                    type="primary" size="large" icon={<DatabaseOutlined />}
                    disabled={selected.length === 0} loading={saving} onClick={save} block
                  >
                    保存所选题目到 AI 题目审核（{selected.length}）
                  </Button>
                )}
                {job.status === 'saved' && (
                  <Alert type="success" showIcon icon={<CheckCircleOutlined />} message="题目已保存，可从左侧“AI 题目审核”查看并由教师确认" />
                )}
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default SimilarQuestionGenerator;
