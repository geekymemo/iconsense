import type { IconLibraryInfo } from './css';

export interface IconDefinition {
    className: string;
    prefix?: string;             
    primaryPrefix?: string;      
    cssValue?: string;           
    sourceFile?: string;
    fontUrl?: string;            
    allFontUrls?: string[];  
    fontFamily?: string;    
    primaryClassName?: string;   
    isAlias?: boolean;           
    siblingClassNames?: string[];
    detectedFontType?: string[]; 

    library?: IconLibraryInfo;
}