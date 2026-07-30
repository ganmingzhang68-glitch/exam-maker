import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Form, Input, InputNumber, Select, Button, Typography,
  Upload, message, Divider, Space, Tag, Alert, Spin,
} from 'antd';
import { InboxOutlined, ArrowLeftOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { createProject, uploadPapers, getEnvironment } from '../services/project';
import type { CreateProjectRequest } from '@exam-maker/shared';

const { Title, Text } = Typography;
const { Dragger } = Upload;
const { TextArea } = Input;

interface EnvInfo {
  pandoc: { available: boolean; version: string | null };
  soffice: { available: boolean };
  python: { available: boolean; hasSympy: boolean; hasNumpy: boolean };
  latex: { available: boolean; engine: string | null };
  ai: { available: boolean; provider: string; model: string };
}

const ProjectNew: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [fileList, setFileList] = useState<File[]>([]);
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getEnvironment().then(data => {
      setEnv(data.env as unknown as EnvInfo);
    }).catch(() => {
      // silently fail, env detection is optional
    }).finally(() => setEnvLoading(false));
  }, []);

  const onFinish = async (values: Record<string, unknown>) => {
    setLoading(true);
    try {
      const project = await createProject({
        title: values.title as string,
        course: values.course as string,
        scope: (values.scope as string) || undefined,
        difficulty: {
          basic: values.diffBasic as number,
          medium: values.diffMedium as number,
          hard: values.diffHard as number,
        },
        nSets: values.nSets as number,
        outputType: values.outputType as CreateProjectRequest['outputType'],
        verifyMode: values.verifyMode as CreateProjectRequest['verifyMode'],
      });

      // Upload past papers if any
      if (fileList.length > 0) {
        message.loading({ content: '正在上传真题文件...', key: 'upload' });
        await uploadPapers(project.id, fileList);
        message.success({ content: `已上传 ${fileList.length} 份真题`, key: 'upload' });
      }

      message.success('项目创建成功');
      navigate(`/projects/${project.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '创建失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>返回</Button>
      </Space>

      <Card>
        <Title level={4}>新建出卷项目</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          配置出卷参数并上传往年真题，系统将自动完成解析、命题、核验全流程
        </Text>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            nSets: 8, outputType: 'latex', verifyMode: 'auto',
            diffBasic: 60, diffMedium: 30, diffHard: 10,
          }}
        >
          <Form.Item name="title" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="例如：2025年《高等数学》期末模拟卷" />
          </Form.Item>

          <Form.Item name="course" label="课程名称" rules={[{ required: true, message: '请输入课程名' }]}>
            <Input placeholder="例如：高等数学（上）" />
          </Form.Item>

          <Form.Item name="scope" label="命题范围（可选，留空由AI从真题归纳）">
            <TextArea rows={2} placeholder="例如：第一章至第六章，重点在定积分应用" />
          </Form.Item>

          <Divider>难度配比（按分值）</Divider>

          <div style={{ display: 'flex', gap: 24 }}>
            <Form.Item name="diffBasic" label="基础%" style={{ flex: 1 }}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="diffMedium" label="中等%" style={{ flex: 1 }}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="diffHard" label="困难%" style={{ flex: 1 }}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: -16, marginBottom: 16 }}>
            默认 60/30/10，三项之和须为 100%
          </Text>

          <div style={{ display: 'flex', gap: 24 }}>
            <Form.Item name="nSets" label="生成套数" style={{ flex: 1 }}>
              <InputNumber min={1} max={50} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="outputType" label="输出格式" style={{ flex: 1 }}>
              <Select options={[
                { value: 'latex', label: 'LaTeX' },
                { value: 'docx', label: 'Word (docx)' },
                { value: 'md', label: 'Markdown' },
              ]} />
            </Form.Item>
            <Form.Item name="verifyMode" label="核验方式" style={{ flex: 1 }}>
              <Select options={[
                { value: 'auto', label: '自动判定' },
                { value: 'computational', label: '计算学科' },
                { value: 'conceptual', label: '概念/文科学科' },
                { value: 'mixed', label: '混合' },
              ]} />
            </Form.Item>
          </div>

          <Divider>运行环境</Divider>
          {envLoading ? (
            <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /> 检测中...</div>
          ) : env ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <Tag icon={env.pandoc.available ? <CheckCircleOutlined /> : <WarningOutlined />}
                color={env.pandoc.available ? 'success' : 'warning'}>
                pandoc{env.pandoc.available ? ' ✅' : ' 未安装'}
              </Tag>
              <Tag icon={env.soffice.available ? <CheckCircleOutlined /> : <WarningOutlined />}
                color={env.soffice.available ? 'success' : 'default'}>
                LibreOffice{env.soffice.available ? ' ✅' : ' 未安装'}
              </Tag>
              <Tag icon={env.python.available ? <CheckCircleOutlined /> : <WarningOutlined />}
                color={env.python.available ? (env.python.hasSympy ? 'success' : 'warning') : 'default'}>
                Python{env.python.hasSympy ? ' + sympy ✅' : env.python.available ? ' (无sympy)' : ' 未安装'}
              </Tag>
              <Tag icon={env.latex.available ? <CheckCircleOutlined /> : <WarningOutlined />}
                color={env.latex.available ? 'success' : 'default'}>
                LaTeX{env.latex.available ? ` (${env.latex.engine}) ✅` : ' 未安装'}
              </Tag>
              <Tag icon={env.ai.available ? <CheckCircleOutlined /> : <WarningOutlined />}
                color={env.ai.available ? 'success' : 'error'}>
                🤖 AI{env.ai.available ? ` ${env.ai.provider}/${env.ai.model} ✅` : ' 未配置'}
              </Tag>
            </div>
          ) : null}

          <Divider>上传往年真题</Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="支持的文件格式"
            description={
              <div style={{ fontSize: 13 }}>
                <strong>PDF</strong>: AI 视觉识读 + pdf-parse 文本提取 →
                <strong>DOCX</strong>: pandoc 转 LaTeX →
                <strong>DOC</strong>: LibreOffice→docx→pandoc →
                <strong>TEX/MD</strong>: 规范化处理
              </div>
            }
          />
          <Form.Item>
            <Dragger
              multiple
              beforeUpload={(_file, _fileList) => false}
              onChange={({ fileList: fl }) => {
                setFileList(fl.filter(f => f.originFileObj).map(f => f.originFileObj as File));
              }}
              accept=".pdf,.docx,.doc,.tex,.md,.txt"
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽真题文件到此处</p>
              <p className="ant-upload-hint">支持 PDF / Word / LaTeX / Markdown，单文件最大 50MB</p>
            </Dragger>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              创建项目并开始出卷
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default ProjectNew;
