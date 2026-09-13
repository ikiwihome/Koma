import React, { ReactNode } from 'react';
import './StoryboardLayout.scss';

interface StoryboardLayoutProps {
  header?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  sidebar?: ReactNode;
}

export const StoryboardLayout: React.FC<StoryboardLayoutProps> = ({
  header,
  toolbar,
  children,
  sidebar,
}) => {
  return (
    <div className="storyboard-layout">
      {header && <div className="storyboard-header">{header}</div>}
      <div className="storyboard-body">
        <div className="storyboard-main">
          {toolbar && <div className="storyboard-toolbar">{toolbar}</div>}
          <div className="storyboard-content">
            {children}
          </div>
        </div>
        {sidebar && <div className="storyboard-sidebar">{sidebar}</div>}
      </div>
    </div>
  );
};
